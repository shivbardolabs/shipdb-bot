import postgres from "postgres";

// ─── Environment Types ────────────────────────────────────────

export type DbEnvironment = "prod" | "staging" | "dev";

export const VALID_ENVIRONMENTS: DbEnvironment[] = ["prod", "staging", "dev"];

const ENV_LABELS: Record<DbEnvironment, string> = {
  prod: "🟢 Production",
  staging: "🟡 Staging",
  dev: "🔵 Dev",
};

/**
 * Human-readable label for an environment (e.g. "🟢 Production").
 */
export function envLabel(env: DbEnvironment): string {
  return ENV_LABELS[env];
}

/**
 * Map of environment → DATABASE_URL env var name.
 * Falls back to DATABASE_URL for prod if DATABASE_URL_PROD is not set.
 */
const ENV_VAR_MAP: Record<DbEnvironment, string[]> = {
  prod: ["DATABASE_URL_PROD", "DATABASE_URL"],
  staging: ["DATABASE_URL_STAGING"],
  dev: ["DATABASE_URL_DEV"],
};

// ─── Connection Pool ──────────────────────────────────────────

/**
 * Connection pool keyed by environment.
 * postgres.js manages its own internal pool per instance.
 */
const _pools: Partial<Record<DbEnvironment, ReturnType<typeof postgres>>> = {};

/**
 * Get a database connection for the given environment.
 * Defaults to "prod" if no environment specified.
 */
export function getDb(env: DbEnvironment = "prod") {
  if (_pools[env]) return _pools[env]!;

  const candidates = ENV_VAR_MAP[env];
  let url: string | undefined;
  for (const varName of candidates) {
    url = process.env[varName];
    if (url) break;
  }

  if (!url) {
    const vars = candidates.join(" or ");
    throw new Error(
      `No database URL configured for ${env} environment. Set ${vars} in your environment variables.`
    );
  }

  _pools[env] = postgres(url, {
    max: 5,
    idle_timeout: 20,
    connect_timeout: 15,
    ssl: "require",
  });

  return _pools[env]!;
}

/**
 * Check which environments have database URLs configured.
 */
export function getConfiguredEnvironments(): {
  env: DbEnvironment;
  label: string;
  configured: boolean;
}[] {
  return VALID_ENVIRONMENTS.map((env) => {
    const candidates = ENV_VAR_MAP[env];
    const configured = candidates.some((v) => !!process.env[v]);
    return { env, label: ENV_LABELS[env], configured };
  });
}

// ─── Read-Only Query Helper ───────────────────────────────────

/**
 * Run a read-only SQL query. Rejects anything that isn't a SELECT or WITH.
 */
export async function runReadOnlyQuery(
  query: string,
  env: DbEnvironment = "prod"
): Promise<Record<string, unknown>[]> {
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
    const regex = new RegExp(`\\b${keyword}\\b`, "i");
    if (regex.test(trimmed)) {
      throw new Error(`Query contains forbidden keyword: ${keyword}`);
    }
  }

  const sql = getDb(env);
  const rows = await sql.unsafe(trimmed);
  return rows as Record<string, unknown>[];
}
