import { neon } from "@neondatabase/serverless";

/**
 * Create a Neon SQL client using the DATABASE_URL env var.
 * Uses HTTP-based queries — perfect for Vercel serverless.
 */
export function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not configured");
  return neon(url);
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
  const rows = await sql(trimmed);
  return rows as Record<string, unknown>[];
}
