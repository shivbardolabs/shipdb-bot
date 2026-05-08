import postgres from "postgres";

/**
 * Singleton SQL client backed by postgres.js.
 * Connects to Aurora PostgreSQL (via RDS Proxy) using the DATABASE_URL env var.
 *
 * postgres.js manages an internal connection pool. For Vercel serverless we
 * keep `max` low and set a short `idle_timeout` so connections are released
 * between invocations.
 */
let _sql: ReturnType<typeof postgres> | null = null;

export function getDb() {
  if (_sql) return _sql;

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not configured");

  _sql = postgres(url, {
    max: 5,             // small pool — fine behind RDS Proxy
    idle_timeout: 20,   // seconds before idle connections close
    connect_timeout: 15, // seconds to wait for a new connection
    ssl: "require",     // Aurora requires SSL
  });

  return _sql;
}

/**
 * Run a read-only SQL query. Rejects anything that isn't a SELECT or WITH.
 */
export async function runReadOnlyQuery(query: string): Promise<Record<string, unknown>[]> {
  const trimmed = query.trim().replace(/;$/, "").trim();
  const upper = trimmed.toUpperCase();

  // Only allow SELECT and WITH (CTE) statements
  if (!upper.startsWith("SELECT") && !upper.startsWith("WITH")) {
    throw new Error("Only SELECT queries are allowed");
  }

  // Block dangerous keywords even in subqueries
  const dangerous = [
    "INSERT",
    "UPDATE",
    "DELETE",
    "DROP",
    "ALTER",
    "TRUNCATE",
    "CREATE",
    "GRANT",
    "REVOKE",
    "EXEC",
    "EXECUTE",
    "COPY",
  ];

  for (const keyword of dangerous) {
    // Match keyword as a standalone word (not part of column names)
    const regex = new RegExp(`\\b${keyword}\\b`, "i");
    if (regex.test(trimmed)) {
      throw new Error(`Query contains forbidden keyword: ${keyword}`);
    }
  }

  const sql = getDb();
  // sql.unsafe() executes a raw query string (not a tagged template)
  const rows = await sql.unsafe(trimmed);
  return rows as Record<string, unknown>[];
}
