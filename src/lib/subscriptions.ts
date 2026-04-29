import { getDb } from "./db";
import { postMessage, type SlackBlock } from "./slack";

// Tables that can be subscribed to, with their display config
export const WATCHABLE_TABLES: Record<
  string,
  {
    displayName: string;
    table: string;
    timestampCol: string;
    formatRow: (row: Record<string, unknown>) => string;
  }
> = {
  tenants: {
    displayName: "Clients (Tenants)",
    table: '"Tenant"',
    timestampCol: '"createdAt"',
    formatRow: (r) =>
      `🏢 *${r.name}* (\`${r.slug}\`) — Status: \`${r.status}\` · Tier: \`${r.subscriptionTier || "—"}\``,
  },
  users: {
    displayName: "Users",
    table: '"User"',
    timestampCol: '"createdAt"',
    formatRow: (r) => `👤 *${r.name || "Unnamed"}* — ${r.email} · Role: \`${r.role}\``,
  },
  customers: {
    displayName: "Customers",
    table: '"Customer"',
    timestampCol: '"createdAt"',
    formatRow: (r) =>
      `🧑‍💼 *${r.firstName} ${r.lastName}* — PMB #${r.pmbNumber || "—"} · ${r.email || "No email"} · Status: \`${r.status}\``,
  },
  packages: {
    displayName: "Packages",
    table: '"Package"',
    timestampCol: '"createdAt"',
    formatRow: (r) =>
      `📦 *${r.trackingNumber || "No tracking"}* · ${r.carrier || "Unknown"} · Status: \`${r.status}\``,
  },
  stores: {
    displayName: "Stores",
    table: '"Store"',
    timestampCol: '"createdAt"',
    formatRow: (r) =>
      `🏪 *${r.name || "Unnamed"}* ${r.storeNumber ? `(#${r.storeNumber})` : ""} — ${r.city || ""}${r.state ? `, ${r.state}` : ""}`,
  },
};

/**
 * Ensure the subscription tables exist. Called lazily on first use.
 */
export async function ensureTables() {
  const sql = getDb();
  await sql`
    CREATE TABLE IF NOT EXISTS "_ShipDbSubscription" (
      id SERIAL PRIMARY KEY,
      channel_id TEXT NOT NULL,
      table_key TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(channel_id, table_key)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS "_ShipDbWatermark" (
      table_key TEXT PRIMARY KEY,
      last_checked_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
}

/**
 * Subscribe a channel to updates on a table.
 */
export async function subscribe(
  tableKey: string,
  channelId: string,
  userId: string
): Promise<{ text: string; blocks: SlackBlock[] }> {
  const config = WATCHABLE_TABLES[tableKey];
  if (!config) {
    const available = Object.keys(WATCHABLE_TABLES).join(", ");
    return {
      text: "Unknown table",
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `Unknown table \`${tableKey}\`.\n\nAvailable tables: ${available}`,
          },
        },
      ],
    };
  }

  await ensureTables();
  const sql = getDb();

  try {
    await sql`
      INSERT INTO "_ShipDbSubscription" (channel_id, table_key, created_by)
      VALUES (${channelId}, ${tableKey}, ${userId})
      ON CONFLICT (channel_id, table_key) DO NOTHING
    `;

    // Initialize watermark if not exists
    await sql`
      INSERT INTO "_ShipDbWatermark" (table_key, last_checked_at)
      VALUES (${tableKey}, NOW())
      ON CONFLICT (table_key) DO NOTHING
    `;

    return {
      text: `Subscribed to ${config.displayName}`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `✅ This channel is now subscribed to *${config.displayName}* updates.\n\nNew rows will be posted here automatically (checked every 5 minutes).`,
          },
        },
      ],
    };
  } catch (err) {
    return {
      text: "Subscription error",
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `❌ Failed to subscribe: ${err instanceof Error ? err.message : "Unknown error"}`,
          },
        },
      ],
    };
  }
}

/**
 * Unsubscribe a channel from table updates.
 */
export async function unsubscribe(
  tableKey: string,
  channelId: string
): Promise<{ text: string; blocks: SlackBlock[] }> {
  const config = WATCHABLE_TABLES[tableKey];
  if (!config) {
    const available = Object.keys(WATCHABLE_TABLES).join(", ");
    return {
      text: "Unknown table",
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `Unknown table \`${tableKey}\`.\n\nAvailable tables: ${available}`,
          },
        },
      ],
    };
  }

  await ensureTables();
  const sql = getDb();

  await sql`
    DELETE FROM "_ShipDbSubscription"
    WHERE channel_id = ${channelId} AND table_key = ${tableKey}
  `;

  return {
    text: `Unsubscribed from ${config.displayName}`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `🔕 This channel is no longer subscribed to *${config.displayName}* updates.`,
        },
      },
    ],
  };
}

/**
 * List all subscriptions for a channel.
 */
export async function listSubscriptions(
  channelId: string
): Promise<{ text: string; blocks: SlackBlock[] }> {
  await ensureTables();
  const sql = getDb();

  const rows = await sql`
    SELECT table_key, created_by, created_at
    FROM "_ShipDbSubscription"
    WHERE channel_id = ${channelId}
    ORDER BY created_at
  `;

  if (rows.length === 0) {
    const available = Object.keys(WATCHABLE_TABLES).join(", ");
    return {
      text: "No subscriptions",
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `No active subscriptions in this channel.\n\nSubscribe with: \`/shipdb subscribe <table>\`\nAvailable: ${available}`,
          },
        },
      ],
    };
  }

  const blocks: SlackBlock[] = [
    { type: "header", text: { type: "plain_text", text: "🔔 Active Subscriptions" } },
    { type: "divider" },
  ];

  for (const row of rows) {
    const config = WATCHABLE_TABLES[row.table_key as string];
    const since = row.created_at ? new Date(row.created_at as string).toLocaleDateString() : "N/A";
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `• *${config?.displayName || row.table_key}* — since ${since} (by <@${row.created_by}>)`,
      },
    });
  }

  return { text: `${rows.length} active subscriptions`, blocks };
}

/**
 * Check all subscriptions for new rows and post notifications.
 * Called by the cron job.
 */
export async function checkForUpdates(): Promise<{ checked: number; notified: number }> {
  await ensureTables();
  const sql = getDb();

  // Get all unique table_keys that have subscriptions
  const subscribedTables = await sql`
    SELECT DISTINCT table_key FROM "_ShipDbSubscription"
  `;

  let checked = 0;
  let notified = 0;

  for (const { table_key } of subscribedTables) {
    const key = table_key as string;
    const config = WATCHABLE_TABLES[key];
    if (!config) continue;

    checked++;

    // Get watermark
    const watermarks = await sql`
      SELECT last_checked_at FROM "_ShipDbWatermark" WHERE table_key = ${key}
    `;
    const lastChecked = watermarks.length > 0 ? watermarks[0].last_checked_at : new Date(0).toISOString();

    // Check for new rows using sql.query() for dynamic table/column names
    // (table and column come from our hardcoded WATCHABLE_TABLES, not user input)
    try {
      const queryStr = `SELECT * FROM ${config.table} WHERE ${config.timestampCol} > $1 ORDER BY ${config.timestampCol} DESC LIMIT 20`;
      const result = await sql.query(queryStr, [lastChecked]);
      const newRows = Array.isArray(result) ? result : (result as { rows: Record<string, unknown>[] }).rows;

      if (newRows.length > 0) {
        // Get channels subscribed to this table
        const channels = await sql`
          SELECT channel_id FROM "_ShipDbSubscription" WHERE table_key = ${key}
        `;

        // Build notification
        const blocks: SlackBlock[] = [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `🔔 *${newRows.length} new ${config.displayName}*`,
            },
          },
          { type: "divider" },
        ];

        for (const row of newRows.slice(0, 10)) {
          blocks.push({
            type: "section",
            text: {
              type: "mrkdwn",
              text: config.formatRow(row as Record<string, unknown>),
            },
          });
        }

        if (newRows.length > 10) {
          blocks.push({
            type: "context",
            elements: [{ type: "mrkdwn", text: `_…and ${newRows.length - 10} more_` }],
          });
        }

        // Post to each subscribed channel
        for (const { channel_id } of channels) {
          try {
            await postMessage(channel_id as string, blocks, `${newRows.length} new ${config.displayName}`);
            notified++;
          } catch (err) {
            console.error(`Failed to post to channel ${channel_id}:`, err);
          }
        }
      }

      // Update watermark
      await sql`
        UPDATE "_ShipDbWatermark" SET last_checked_at = NOW() WHERE table_key = ${key}
      `;
    } catch (err) {
      console.error(`Error checking table ${key}:`, err);
    }
  }

  return { checked, notified };
}
