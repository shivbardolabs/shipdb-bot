import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { verifySlackRequest, postToResponseUrl } from "@/lib/slack";
import {
  getClients,
  getClientDetails,
  getUsers,
  getCustomers,
  getPackages,
  getStores,
  getStats,
  searchAll,
  runRawQuery,
} from "@/lib/queries";
import {
  subscribe,
  unsubscribe,
  listSubscriptions,
  WATCHABLE_TABLES,
} from "@/lib/subscriptions";
import {
  type DbEnvironment,
  VALID_ENVIRONMENTS,
  getConfiguredEnvironments,
  envLabel,
} from "@/lib/db";

// ─── Help Text ────────────────────────────────────────────────

const HELP_BLOCKS = [
  {
    type: "header",
    text: { type: "plain_text", text: "📖 ShipDB Commands" },
  },
  { type: "divider" },
  {
    type: "section",
    text: {
      type: "mrkdwn",
      text: [
        "*Queries:*",
        "`/shipdb stats` — Database overview (counts for clients, users, customers, packages)",
        "`/shipdb clients` — List all clients (tenants)",
        "`/shipdb client <name>` — Details for a specific client",
        "`/shipdb users [client]` — List users (optionally filter by client name)",
        "`/shipdb customers [client]` — List customers (optionally filter by client name)",
        "`/shipdb packages [status]` — Package overview (optionally filter: checked_in, released, etc.)",
        "`/shipdb stores` — List all stores",
        "`/shipdb search <term>` — Search across clients, users, and customers",
        "`/shipdb sql <SELECT query>` — Run a read-only SQL query",
        "",
        "*Environments:*",
        "`/shipdb env` — Show available environments",
        "Add `--env dev|staging|prod` to any query to target a specific environment",
        "_Example:_ `/shipdb stats --env dev` or `/shipdb clients --env staging`",
        "_Default: production_",
        "",
        "*Subscriptions:*",
        "`/shipdb subscribe <table>` — Subscribe this channel to new-row notifications",
        "`/shipdb unsubscribe <table>` — Unsubscribe this channel",
        "`/shipdb subscriptions` — List active subscriptions for this channel",
        `_Available tables: ${Object.keys(WATCHABLE_TABLES).join(", ")}_`,
        "",
        "`/shipdb help` — Show this help message",
      ].join("\n"),
    },
  },
  {
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: "🔒 All queries are *read-only*. Results are visible only to you (ephemeral). Subscription notifications are posted publicly to the channel.",
      },
    ],
  },
];

// ─── Environment Parsing ──────────────────────────────────────

/**
 * Extract `--env <value>` or `--env=<value>` from a text string.
 * Returns the parsed environment and the text with the flag removed.
 */
function parseEnvFlag(text: string): { env: DbEnvironment; cleanText: string } {
  let env: DbEnvironment = "prod";
  let cleanText = text;

  // Match --env=value or --env value
  const envEqualsMatch = cleanText.match(/--env=(prod|staging|dev|production|stg)\b/i);
  const envSpaceMatch = cleanText.match(/--env\s+(prod|staging|dev|production|stg)\b/i);

  const match = envEqualsMatch || envSpaceMatch;

  if (match) {
    const rawValue = match[1].toLowerCase();

    // Normalize aliases
    if (rawValue === "production") {
      env = "prod";
    } else if (rawValue === "stg") {
      env = "staging";
    } else {
      env = rawValue as DbEnvironment;
    }

    // Remove the flag from the text
    cleanText = cleanText.replace(match[0], "").trim();
    // Clean up any double spaces left behind
    cleanText = cleanText.replace(/\s{2,}/g, " ").trim();
  }

  return { env, cleanText };
}

// ─── Route Handler ────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const params = new URLSearchParams(rawBody);

    // Verify Slack signature
    const signingSecret = process.env.SLACK_SIGNING_SECRET;
    if (signingSecret) {
      const timestamp = req.headers.get("x-slack-request-timestamp") || "";
      const signature = req.headers.get("x-slack-signature") || "";
      if (!verifySlackRequest(signingSecret, timestamp, rawBody, signature)) {
        return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
      }
    }

    const text = (params.get("text") || "").trim();
    const responseUrl = params.get("response_url") || "";
    const userId = params.get("user_id") || "";
    const channelId = params.get("channel_id") || "";

    // Parse --env flag before splitting into subcommand/args
    const { env, cleanText } = parseEnvFlag(text);

    const parts = cleanText.split(/\s+/);
    const subcommand = (parts[0] || "help").toLowerCase();
    const args = parts.slice(1).join(" ");

    after(async () => {
      try {
        await processCommand(subcommand, args, responseUrl, userId, channelId, env);
      } catch (err) {
        console.error("Command processing error:", err);
        await postToResponseUrl(
          responseUrl,
          [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `❌ *Error:* ${err instanceof Error ? err.message : "Unknown error"}`,
              },
            },
          ],
          "Error processing command",
          true
        );
      }
    });

    // Acknowledge immediately
    return NextResponse.json({
      response_type: "ephemeral",
      text: `⏳ Querying ${env === "prod" ? "" : `${env} `}database…`,
    });
  } catch (err) {
    console.error("Slash command handler error:", err);
    return NextResponse.json({
      response_type: "ephemeral",
      text: `❌ Error: ${err instanceof Error ? err.message : "Unknown error"}`,
    });
  }
}

// ─── Command Processor ───────────────────────────────────────

async function processCommand(
  subcommand: string,
  args: string,
  responseUrl: string,
  userId: string,
  channelId: string,
  env: DbEnvironment
) {
  let result: { text: string; blocks: unknown[] };

  switch (subcommand) {
    case "help":
      result = { text: "ShipDB Commands", blocks: HELP_BLOCKS };
      break;

    case "env":
    case "envs":
    case "environments": {
      const envs = getConfiguredEnvironments();
      const lines = envs.map((e) => {
        const status = e.configured ? "✅" : "❌ Not configured";
        return `${e.label}  \`${e.env}\`  —  ${status}`;
      });

      result = {
        text: "Available environments",
        blocks: [
          {
            type: "header",
            text: { type: "plain_text", text: "🌐 Environments" },
          },
          { type: "divider" },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: lines.join("\n"),
            },
          },
          {
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text: "Add `--env dev`, `--env staging`, or `--env prod` to any query command.\nDefault: *production*",
              },
            ],
          },
        ],
      };
      break;
    }

    case "stats":
      result = await getStats(env);
      break;

    case "clients":
      result = await getClients(env);
      break;

    case "client":
      if (!args) {
        result = {
          text: "Please specify a client name",
          blocks: [{ type: "section", text: { type: "mrkdwn", text: "Usage: `/shipdb client <name>`" } }],
        };
      } else {
        result = await getClientDetails(args, env);
      }
      break;

    case "users":
      result = await getUsers(args || undefined, env);
      break;

    case "customers":
      result = await getCustomers(args || undefined, env);
      break;

    case "packages":
      result = await getPackages(args || undefined, env);
      break;

    case "stores":
      result = await getStores(env);
      break;

    case "search":
      if (!args) {
        result = {
          text: "Please specify a search term",
          blocks: [{ type: "section", text: { type: "mrkdwn", text: "Usage: `/shipdb search <term>`" } }],
        };
      } else {
        result = await searchAll(args, env);
      }
      break;

    case "sql": {
      const allowedUsers = process.env.SQL_ALLOWED_USER_IDS;
      if (allowedUsers && !allowedUsers.split(",").includes(userId)) {
        result = {
          text: "Not authorized",
          blocks: [
            {
              type: "section",
              text: { type: "mrkdwn", text: "❌ You don't have permission to run raw SQL queries." },
            },
          ],
        };
        break;
      }

      if (!args) {
        result = {
          text: "Please provide a SQL query",
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: 'Usage: `/shipdb sql SELECT * FROM "Tenant" LIMIT 5`\n\n_Only SELECT queries are allowed. Table names use PascalCase and must be quoted._',
              },
            },
          ],
        };
      } else {
        result = await runRawQuery(args, env);
      }
      break;
    }

    // ─── Subscription Commands ───────────────────────────
    // Note: Subscriptions always operate against the prod database
    case "subscribe": {
      if (!args) {
        const available = Object.keys(WATCHABLE_TABLES).join(", ");
        result = {
          text: "Please specify a table",
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `Usage: \`/shipdb subscribe <table>\`\n\nAvailable tables: ${available}`,
              },
            },
          ],
        };
      } else {
        const tableKey = args.split(/\s+/)[0].toLowerCase();
        result = await subscribe(tableKey, channelId, userId);
      }
      break;
    }

    case "unsubscribe": {
      if (!args) {
        result = {
          text: "Please specify a table",
          blocks: [
            {
              type: "section",
              text: { type: "mrkdwn", text: "Usage: `/shipdb unsubscribe <table>`" },
            },
          ],
        };
      } else {
        const tableKey = args.split(/\s+/)[0].toLowerCase();
        result = await unsubscribe(tableKey, channelId);
      }
      break;
    }

    case "subscriptions":
      result = await listSubscriptions(channelId);
      break;

    default:
      result = {
        text: `Unknown command: ${subcommand}`,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `Unknown command \`${subcommand}\`. Try \`/shipdb help\` for available commands.`,
            },
          },
        ],
      };
  }

  await postToResponseUrl(responseUrl, result.blocks as never[], result.text, true);
}
