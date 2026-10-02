// The one production guard (B2 invariant 23, ruling H35 (5)): every destructive or test command calls
// assertNotProduction before its first write. The stage lives in data, `settings.environment`, never in a project ref.
import pg from "pg";

// undefined_table: a fresh or just-emptied database has no `settings` yet, which reads as not production.
const UNDEFINED_TABLE = "42P01";

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isProductionEnvironment(value) {
  return value === "production";
}

/**
 * @param {string} dbUrl
 * @returns {Promise<string | null>}
 */
async function readSettingsEnvironment(dbUrl) {
  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();
  try {
    /** @type {import("pg").QueryResult<{ value: string | null }>} */
    const result = await client.query(
      "select value #>> '{}' as value from public.settings where key = 'environment'",
    );
    return result.rows[0]?.value ?? null;
  } finally {
    await client.end();
  }
}

/**
 * @param {unknown} error
 * @returns {boolean}
 */
function isMissingRelation(error) {
  return error instanceof Error && "code" in error && error.code === UNDEFINED_TABLE;
}

/**
 * Resolves when the database is not in production; throws `refusing: production database` when it is.
 * @param {{ dbUrl?: string | undefined, readEnvironment?: (dbUrl: string) => Promise<string | null> }} [options]
 */
export async function assertNotProduction({
  dbUrl = process.env["DEV_DB_URL"],
  readEnvironment = readSettingsEnvironment,
} = {}) {
  if (dbUrl === undefined || dbUrl === "") throw new Error("refusing: DEV_DB_URL is not set");
  /** @type {string | null} */
  let environment;
  try {
    environment = await readEnvironment(dbUrl);
  } catch (error) {
    if (!isMissingRelation(error)) throw error;
    environment = null;
  }
  if (isProductionEnvironment(environment)) throw new Error("refusing: production database");
}
