import { getDb, runReadOnlyQuery } from "./db";
import type { SlackBlock } from "./slack";

// ─── Clients (Tenants) ────────────────────────────────────────

export async function getClients(): Promise<{ text: string; blocks: SlackBlock[] }> {
  const sql = getDb();
  const rows = await sql`
    SELECT t.id, t.name, t.slug, t.status, t."subscriptionTier", t."createdAt",
           COUNT(DISTINCT u.id) as user_count,
           COUNT(DISTINCT c.id) as customer_count
    FROM "Tenant" t
    LEFT JOIN "User" u ON u."tenantId" = t.id
    LEFT JOIN "Customer" c ON c."tenantId" = t.id AND c."deletedAt" IS NULL
    GROUP BY t.id, t.name, t.slug, t.status, t."subscriptionTier", t."createdAt"
    ORDER BY t."createdAt" DESC
  `;

  if (rows.length === 0) {
    return {
      text: "No clients found",
      blocks: [{ type: "section", text: { type: "mrkdwn", text: "No clients found in the database." } }],
    };
  }

  const blocks: SlackBlock[] = [
    { type: "header", text: { type: "plain_text", text: `📋 Clients (${rows.length} total)` } },
    { type: "divider" },
  ];

  for (const row of rows) {
    const status = row.status === "active" ? "🟢" : row.status === "suspended" ? "🟡" : "🔴";
    const created = row.createdAt ? new Date(row.createdAt as string).toLocaleDateString() : "N/A";
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${status} *${row.name}*\n\`${row.slug}\` · Tier: \`${row.subscriptionTier || "—"}\` · Since: ${created}`,
      },
      fields: [
        { type: "mrkdwn", text: `*Users:* ${row.user_count}` },
        { type: "mrkdwn", text: `*Customers:* ${row.customer_count}` },
      ],
    });
  }

  return { text: `Found ${rows.length} clients`, blocks };
}

export async function getClientDetails(search: string): Promise<{ text: string; blocks: SlackBlock[] }> {
  const sql = getDb();
  const rows = await sql`
    SELECT t.* FROM "Tenant" t
    WHERE LOWER(t.name) LIKE ${"%" + search.toLowerCase() + "%"}
       OR LOWER(t.slug) LIKE ${"%" + search.toLowerCase() + "%"}
    LIMIT 1
  `;

  if (rows.length === 0) {
    return {
      text: `No client matching "${search}"`,
      blocks: [{ type: "section", text: { type: "mrkdwn", text: `No client matching \`${search}\`` } }],
    };
  }

  const t = rows[0];

  // Get users for this tenant
  const users = await sql`
    SELECT id, name, email, role, "lastLoginAt" FROM "User"
    WHERE "tenantId" = ${t.id}
    ORDER BY role, name
  `;

  // Get customer count
  const custCount = await sql`
    SELECT COUNT(*) as count FROM "Customer"
    WHERE "tenantId" = ${t.id} AND "deletedAt" IS NULL
  `;

  // Get package count
  const pkgCount = await sql`
    SELECT COUNT(*) as count FROM "Package" p
    JOIN "Customer" c ON p."customerId" = c.id
    WHERE c."tenantId" = ${t.id}
  `;

  // Get store count
  const storeCount = await sql`
    SELECT COUNT(*) as count FROM "Store"
    WHERE "tenantId" = ${t.id}
  `;

  const status = t.status === "active" ? "🟢 Active" : t.status === "suspended" ? "🟡 Suspended" : `🔴 ${t.status}`;

  const blocks: SlackBlock[] = [
    { type: "header", text: { type: "plain_text", text: `🏢 ${t.name}` } },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Slug:*\n\`${t.slug}\`` },
        { type: "mrkdwn", text: `*Status:*\n${status}` },
        { type: "mrkdwn", text: `*Tier:*\n${t.subscriptionTier || "—"}` },
        { type: "mrkdwn", text: `*Created:*\n${t.createdAt ? new Date(t.createdAt as string).toLocaleDateString() : "N/A"}` },
        { type: "mrkdwn", text: `*Customers:*\n${custCount[0].count}` },
        { type: "mrkdwn", text: `*Packages:*\n${pkgCount[0].count}` },
        { type: "mrkdwn", text: `*Stores:*\n${storeCount[0].count}` },
        { type: "mrkdwn", text: `*Users:*\n${users.length}` },
      ],
    },
    { type: "divider" },
    { type: "section", text: { type: "mrkdwn", text: "*Users:*" } },
  ];

  if (users.length === 0) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: "_No users_" } });
  } else {
    for (const u of users) {
      const lastLogin = u.lastLoginAt ? new Date(u.lastLoginAt as string).toLocaleDateString() : "Never";
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `• *${u.name || "Unnamed"}* — ${u.email}\n  Role: \`${u.role}\` · Last login: ${lastLogin}`,
        },
      });
    }
  }

  return { text: `Client details for ${t.name}`, blocks };
}

// ─── Users ────────────────────────────────────────────────────

export async function getUsers(clientFilter?: string): Promise<{ text: string; blocks: SlackBlock[] }> {
  const sql = getDb();

  let rows;
  if (clientFilter) {
    rows = await sql`
      SELECT u.id, u.name, u.email, u.role, u."lastLoginAt", u."loginCount",
             u."createdAt", t.name as tenant_name, t.slug as tenant_slug
      FROM "User" u
      LEFT JOIN "Tenant" t ON u."tenantId" = t.id
      WHERE LOWER(t.name) LIKE ${"%" + clientFilter.toLowerCase() + "%"}
         OR LOWER(t.slug) LIKE ${"%" + clientFilter.toLowerCase() + "%"}
      ORDER BY u."createdAt" DESC
      LIMIT 50
    `;
  } else {
    rows = await sql`
      SELECT u.id, u.name, u.email, u.role, u."lastLoginAt", u."loginCount",
             u."createdAt", t.name as tenant_name, t.slug as tenant_slug
      FROM "User" u
      LEFT JOIN "Tenant" t ON u."tenantId" = t.id
      ORDER BY u."createdAt" DESC
      LIMIT 50
    `;
  }

  if (rows.length === 0) {
    return {
      text: "No users found",
      blocks: [{ type: "section", text: { type: "mrkdwn", text: clientFilter ? `No users found for client \`${clientFilter}\`` : "No users found." } }],
    };
  }

  const blocks: SlackBlock[] = [
    { type: "header", text: { type: "plain_text", text: `👤 Users (${rows.length}${rows.length === 50 ? "+" : ""})` } },
    { type: "divider" },
  ];

  for (const u of rows) {
    const lastLogin = u.lastLoginAt ? new Date(u.lastLoginAt as string).toLocaleDateString() : "Never";
    const roleEmoji = u.role === "superadmin" ? "🔴" : u.role === "admin" ? "🟣" : u.role === "manager" ? "🟠" : "🔵";
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${roleEmoji} *${u.name || "Unnamed"}* — ${u.email}\n\`${u.role}\` · Client: ${u.tenant_name || "—"} · Last login: ${lastLogin} · Logins: ${u.loginCount || 0}`,
      },
    });
  }

  return { text: `Found ${rows.length} users`, blocks };
}

// ─── Customers ────────────────────────────────────────────────

export async function getCustomers(clientFilter?: string): Promise<{ text: string; blocks: SlackBlock[] }> {
  const sql = getDb();

  let rows;
  if (clientFilter) {
    rows = await sql`
      SELECT c.id, c."firstName", c."lastName", c.email, c.phone,
             c."pmbNumber", c.status, c.platform, c."dateOpened",
             c."form1583Status", c."renewalDate",
             t.name as tenant_name
      FROM "Customer" c
      LEFT JOIN "Tenant" t ON c."tenantId" = t.id
      WHERE c."deletedAt" IS NULL
        AND (LOWER(t.name) LIKE ${"%" + clientFilter.toLowerCase() + "%"}
             OR LOWER(t.slug) LIKE ${"%" + clientFilter.toLowerCase() + "%"})
      ORDER BY c."createdAt" DESC
      LIMIT 50
    `;
  } else {
    rows = await sql`
      SELECT c.id, c."firstName", c."lastName", c.email, c.phone,
             c."pmbNumber", c.status, c.platform, c."dateOpened",
             c."form1583Status", c."renewalDate",
             t.name as tenant_name
      FROM "Customer" c
      LEFT JOIN "Tenant" t ON c."tenantId" = t.id
      WHERE c."deletedAt" IS NULL
      ORDER BY c."createdAt" DESC
      LIMIT 50
    `;
  }

  if (rows.length === 0) {
    return {
      text: "No customers found",
      blocks: [{ type: "section", text: { type: "mrkdwn", text: clientFilter ? `No customers found for client \`${clientFilter}\`` : "No customers found." } }],
    };
  }

  const blocks: SlackBlock[] = [
    { type: "header", text: { type: "plain_text", text: `🧑‍💼 Customers (${rows.length}${rows.length === 50 ? "+" : ""})` } },
    { type: "divider" },
  ];

  for (const c of rows) {
    const statusEmoji = c.status === "active" ? "🟢" : c.status === "suspended" ? "🟡" : "🔴";
    const opened = c.dateOpened ? new Date(c.dateOpened as string).toLocaleDateString() : "N/A";
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${statusEmoji} *${c.firstName} ${c.lastName}* — PMB #${c.pmbNumber}\n${c.email || "No email"} · ${c.phone || "No phone"} · Client: ${c.tenant_name || "—"}\nPlatform: \`${c.platform}\` · 1583: \`${c.form1583Status || "—"}\` · Since: ${opened}`,
      },
    });
  }

  return { text: `Found ${rows.length} customers`, blocks };
}

// ─── Packages ─────────────────────────────────────────────────

export async function getPackages(statusFilter?: string): Promise<{ text: string; blocks: SlackBlock[] }> {
  const sql = getDb();

  // Get package counts by status
  const stats = await sql`
    SELECT p.status, COUNT(*) as count
    FROM "Package" p
    GROUP BY p.status
    ORDER BY count DESC
  `;

  // Get recent packages
  let recentRows;
  if (statusFilter) {
    recentRows = await sql`
      SELECT p.id, p."trackingNumber", p.carrier, p.status, p."receivedAt",
             p."releasedAt", p."storageLocation",
             c."firstName", c."lastName", c."pmbNumber",
             t.name as tenant_name
      FROM "Package" p
      LEFT JOIN "Customer" c ON p."customerId" = c.id
      LEFT JOIN "Tenant" t ON c."tenantId" = t.id
      WHERE LOWER(p.status) = ${statusFilter.toLowerCase()}
      ORDER BY p."receivedAt" DESC NULLS LAST
      LIMIT 20
    `;
  } else {
    recentRows = await sql`
      SELECT p.id, p."trackingNumber", p.carrier, p.status, p."receivedAt",
             p."releasedAt", p."storageLocation",
             c."firstName", c."lastName", c."pmbNumber",
             t.name as tenant_name
      FROM "Package" p
      LEFT JOIN "Customer" c ON p."customerId" = c.id
      LEFT JOIN "Tenant" t ON c."tenantId" = t.id
      ORDER BY p."receivedAt" DESC NULLS LAST
      LIMIT 20
    `;
  }

  const blocks: SlackBlock[] = [
    { type: "header", text: { type: "plain_text", text: "📦 Package Overview" } },
  ];

  if (stats.length > 0) {
    const statLines = stats.map((s) => `\`${s.status}\`: ${s.count}`).join("  ·  ");
    blocks.push({ type: "section", text: { type: "mrkdwn", text: `*By status:* ${statLines}` } });
  }

  blocks.push({ type: "divider" });
  blocks.push({
    type: "section",
    text: { type: "mrkdwn", text: `*Recent packages${statusFilter ? ` (${statusFilter})` : ""}:*` },
  });

  for (const p of recentRows) {
    const statusEmoji =
      p.status === "checked_in" ? "📥" : p.status === "released" ? "📤" : p.status === "returned" ? "↩️" : "📦";
    const received = p.receivedAt ? new Date(p.receivedAt as string).toLocaleDateString() : "N/A";
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${statusEmoji} *${p.trackingNumber || "No tracking"}* · ${p.carrier || "Unknown carrier"}\nCustomer: ${p.firstName || ""} ${p.lastName || ""} (PMB #${p.pmbNumber || "—"}) · Client: ${p.tenant_name || "—"}\nStatus: \`${p.status}\` · Location: \`${p.storageLocation || "—"}\` · Received: ${received}`,
      },
    });
  }

  return { text: "Package overview", blocks };
}

// ─── Stores ───────────────────────────────────────────────────

export async function getStores(): Promise<{ text: string; blocks: SlackBlock[] }> {
  const sql = getDb();
  const rows = await sql`
    SELECT s.id, s.name, s."storeNumber", s.address, s.city, s.state, s."zipCode",
           s.phone, s.email, s.status, s."createdAt",
           t.name as tenant_name
    FROM "Store" s
    LEFT JOIN "Tenant" t ON s."tenantId" = t.id
    ORDER BY s."createdAt" DESC
  `;

  if (rows.length === 0) {
    return {
      text: "No stores found",
      blocks: [{ type: "section", text: { type: "mrkdwn", text: "No stores found in the database." } }],
    };
  }

  const blocks: SlackBlock[] = [
    { type: "header", text: { type: "plain_text", text: `🏪 Stores (${rows.length} total)` } },
    { type: "divider" },
  ];

  for (const s of rows) {
    const status = s.status === "active" ? "🟢" : "🔴";
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${status} *${s.name || "Unnamed Store"}* ${s.storeNumber ? `(#${s.storeNumber})` : ""}\n${s.address || ""}${s.city ? `, ${s.city}` : ""}${s.state ? `, ${s.state}` : ""} ${s.zipCode || ""}\n${s.phone || ""} · ${s.email || ""} · Client: ${s.tenant_name || "—"}`,
      },
    });
  }

  return { text: `Found ${rows.length} stores`, blocks };
}

// ─── Stats ────────────────────────────────────────────────────

export async function getStats(): Promise<{ text: string; blocks: SlackBlock[] }> {
  const sql = getDb();

  const [tenants, users, customers, packages, stores] = await Promise.all([
    sql`SELECT COUNT(*) as count, COUNT(*) FILTER (WHERE status = 'active') as active FROM "Tenant"`,
    sql`SELECT COUNT(*) as count FROM "User"`,
    sql`SELECT COUNT(*) as count, COUNT(*) FILTER (WHERE status = 'active') as active FROM "Customer" WHERE "deletedAt" IS NULL`,
    sql`SELECT COUNT(*) as count FROM "Package"`,
    sql`SELECT COUNT(*) as count FROM "Store"`,
  ]);

  // LoginSession may not exist in all environments
  let logins;
  try {
    logins = await sql`SELECT COUNT(*) as count FROM "LoginSession" WHERE "createdAt" > NOW() - INTERVAL '7 days'`;
  } catch {
    logins = [{ count: "N/A" }];
  }

  const blocks: SlackBlock[] = [
    { type: "header", text: { type: "plain_text", text: "📊 ShipOS Database Overview" } },
    { type: "divider" },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Clients (Tenants):*\n${tenants[0].count} total (${tenants[0].active} active)` },
        { type: "mrkdwn", text: `*Users:*\n${users[0].count}` },
        { type: "mrkdwn", text: `*Customers:*\n${customers[0].count} total (${customers[0].active} active)` },
        { type: "mrkdwn", text: `*Packages:*\n${packages[0].count}` },
        { type: "mrkdwn", text: `*Stores:*\n${stores[0].count}` },
        { type: "mrkdwn", text: `*Logins (7d):*\n${logins[0].count}` },
      ],
    },
  ];

  return { text: "ShipOS database overview", blocks };
}

// ─── Search ───────────────────────────────────────────────────

export async function searchAll(term: string): Promise<{ text: string; blocks: SlackBlock[] }> {
  const sql = getDb();
  const like = `%${term.toLowerCase()}%`;

  const [tenantHits, userHits, customerHits] = await Promise.all([
    sql`SELECT id, name, slug, status FROM "Tenant" WHERE LOWER(name) LIKE ${like} OR LOWER(slug) LIKE ${like} LIMIT 5`,
    sql`SELECT id, name, email, role FROM "User" WHERE LOWER(name) LIKE ${like} OR LOWER(email) LIKE ${like} LIMIT 5`,
    sql`
      SELECT id, "firstName", "lastName", email, "pmbNumber", status
      FROM "Customer"
      WHERE "deletedAt" IS NULL
        AND (LOWER("firstName") LIKE ${like}
             OR LOWER("lastName") LIKE ${like}
             OR LOWER(email) LIKE ${like}
             OR "pmbNumber" LIKE ${like})
      LIMIT 5
    `,
  ]);

  const total = tenantHits.length + userHits.length + customerHits.length;

  if (total === 0) {
    return {
      text: `No results for "${term}"`,
      blocks: [{ type: "section", text: { type: "mrkdwn", text: `No results for \`${term}\` across clients, users, or customers.` } }],
    };
  }

  const blocks: SlackBlock[] = [
    { type: "header", text: { type: "plain_text", text: `🔍 Search: "${term}" (${total} results)` } },
    { type: "divider" },
  ];

  if (tenantHits.length > 0) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: "*Clients:*" } });
    for (const t of tenantHits) {
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: `• *${t.name}* (\`${t.slug}\`) — ${t.status}` },
      });
    }
  }

  if (userHits.length > 0) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: "*Users:*" } });
    for (const u of userHits) {
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: `• *${u.name || "Unnamed"}* — ${u.email} (\`${u.role}\`)` },
      });
    }
  }

  if (customerHits.length > 0) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: "*Customers:*" } });
    for (const c of customerHits) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `• *${c.firstName} ${c.lastName}* — PMB #${c.pmbNumber} — ${c.email || "No email"} (${c.status})`,
        },
      });
    }
  }

  return { text: `Found ${total} results for "${term}"`, blocks };
}

// ─── Raw SQL ──────────────────────────────────────────────────

export async function runRawQuery(query: string): Promise<{ text: string; blocks: SlackBlock[] }> {
  const rows = await runReadOnlyQuery(query);

  if (rows.length === 0) {
    return {
      text: "Query returned no results",
      blocks: [{ type: "section", text: { type: "mrkdwn", text: "Query returned 0 rows." } }],
    };
  }

  // Format as a code block table
  const cols = Object.keys(rows[0]);
  const maxRows = 25; // Slack has a character limit
  const displayRows = rows.slice(0, maxRows);

  // Build table
  let table = cols.join(" | ") + "\n";
  table += cols.map(() => "---").join(" | ") + "\n";
  for (const row of displayRows) {
    table += cols.map((c) => String(row[c] ?? "NULL")).join(" | ") + "\n";
  }

  const truncated = rows.length > maxRows ? `\n_…showing ${maxRows} of ${rows.length} rows_` : "";

  const blocks: SlackBlock[] = [
    {
      type: "section",
      text: { type: "mrkdwn", text: `*Query:*\n\`\`\`${query}\`\`\`` },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: `*Results (${rows.length} rows):*\n\`\`\`${table}\`\`\`${truncated}` },
    },
  ];

  return { text: `Query returned ${rows.length} rows`, blocks };
}
