import { NextRequest, NextResponse } from "next/server";
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
        "`/shipdb stats` — Database overview (counts for clients, users, customers, packages)",
        "`/shipdb clients` — List all clients (tenants)",
        "`/shipdb client <name>` — Details for a specific client",
        "`/shipdb users [client]` — List users (optionally filter by client name)",
        "`/shipdb customers [client]` — List customers (optionally filter by client name)",
        "`/shipdb packages [status]` — Package overview (optionally filter: checked_in, released, etc.)",
        "`/shipdb stores` — List all stores",
        "`/shipdb search <term>` — Search across clients, users, and customers",
        "`/shipdb sql <SELECT query>` — Run a read-only SQL query",
        "`/shipdb help` — Show this help message",
      ].join("\n"),
    },
  },
  {
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: "🔒 All queries are *read-only*. Results are visible only to you (ephemeral).",
      },
    ],
  },
];

export async function POST(req: NextRequest) {
  // Read the raw body for signature verification
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

  // Parse the subcommand
  const parts = text.split(/\s+/);
  const subcommand = (parts[0] || "help").toLowerCase();
  const args = parts.slice(1).join(" ");

  // Acknowledge immediately (Slack requires response within 3 seconds)
  // Then process in background using response_url
  const ackResponse = NextResponse.json({
    response_type: "ephemeral",
    text: "⏳ Querying database…",
  });

  // Process the query asynchronously using response_url
  processCommand(subcommand, args, responseUrl, userId).catch((err) => {
    console.error("Command processing error:", err);
    postToResponseUrl(
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
  });

  return ackResponse;
}

async function processCommand(
  subcommand: string,
  args: string,
  responseUrl: string,
  userId: string
) {
  let result: { text: string; blocks: unknown[] };

  switch (subcommand) {
    case "help":
      result = { text: "ShipDB Commands", blocks: HELP_BLOCKS };
      break;

    case "stats":
      result = await getStats();
      break;

    case "clients":
      result = await getClients();
      break;

    case "client":
      if (!args) {
        result = {
          text: "Please specify a client name",
          blocks: [{ type: "section", text: { type: "mrkdwn", text: "Usage: `/shipdb client <name>`" } }],
        };
      } else {
        result = await getClientDetails(args);
      }
      break;

    case "users":
      result = await getUsers(args || undefined);
      break;

    case "customers":
      result = await getCustomers(args || undefined);
      break;

    case "packages":
      result = await getPackages(args || undefined);
      break;

    case "stores":
      result = await getStores();
      break;

    case "search":
      if (!args) {
        result = {
          text: "Please specify a search term",
          blocks: [{ type: "section", text: { type: "mrkdwn", text: "Usage: `/shipdb search <term>`" } }],
        };
      } else {
        result = await searchAll(args);
      }
      break;

    case "sql": {
      // Check if user is allowed to run raw SQL
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
        result = await runRawQuery(args);
      }
      break;
    }

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

  // Send the actual response
  await postToResponseUrl(responseUrl, result.blocks as never[], result.text, true);
}
