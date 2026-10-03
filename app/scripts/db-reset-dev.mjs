// `bun run db:reset [-- --accept-foreign | --local]`: the no-Docker stand-in for `supabase db reset` (S50, B2 Files).
// Empties `public`, drops the pgmq queues, unschedules the cron jobs the migrations create, then pushes every
// migration from zero through scripts/db-push.mjs. The ref check runs before anything opens a connection.
// `--local` (H1 b) works only on a database at 127.0.0.1, the ephemeral stack of CI's `db` job.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { mainMigrationFiles } from "./db-push.mjs";
import { assertNotProduction } from "./lib/assert-not-production.mjs";
import { findBranchMigrations, migrationFiles } from "./lib/push-guard.mjs";
import {
  checkResetTarget,
  cronJobNames,
  findForeignMigrations,
  isLocalDbUrl,
} from "./lib/reset-guard.mjs";

const APP = fileURLToPath(new URL("..", import.meta.url));
const MIGRATIONS = fileURLToPath(new URL("../supabase/migrations/", import.meta.url));
const LINKED_REF = fileURLToPath(new URL("../supabase/.temp/project-ref", import.meta.url));
const FLAGS = ["--accept-foreign", "--local"];

/**
 * @param {pg.Client} client
 * @param {string} name
 * @returns {Promise<boolean>}
 */
async function relationExists(client, name) {
  /** @type {pg.QueryResult<{ found: boolean }>} */
  const result = await client.query("select to_regclass($1) is not null as found", [name]);
  return result.rows[0]?.found === true;
}

/**
 * Runs the emptying statements in one transaction. Dropping the schema also drops Supabase's default privileges on
 * it, so every grant comes from migration 10. `auth` and `storage` are never touched.
 * @param {pg.Client} client
 * @param {string[]} files
 */
async function emptyDatabase(client, files) {
  await client.query("begin");
  if (await relationExists(client, "cron.job")) {
    const names = cronJobNames(files.map((file) => readFileSync(`${MIGRATIONS}${file}`, "utf8")));
    await client.query("select cron.unschedule(jobname) from cron.job where jobname = any($1)", [
      names,
    ]);
  }
  if (await relationExists(client, "pgmq.meta")) {
    await client.query("select pgmq.drop_queue(queue_name) from pgmq.meta");
  }
  await client.query("drop schema public cascade");
  // app.is_staff() reads public tables only in its body, so dropping public leaves it behind (migration app_schema).
  await client.query("drop schema if exists app cascade");
  await client.query("create schema public");
  await client.query("grant usage on schema public to anon, authenticated, service_role");
  await client.query("grant all on schema public to postgres");
  if (await relationExists(client, "supabase_migrations.schema_migrations")) {
    await client.query("truncate supabase_migrations.schema_migrations");
  }
  await client.query("commit");
}

/**
 * @param {string[]} args
 * @param {NodeJS.ProcessEnv} env
 */
function run(args, env) {
  const result = spawnSync(process.execPath, args, { cwd: APP, stdio: "inherit", env });
  if (result.status !== 0) throw new Error(`${args.join(" ")} exited ${String(result.status)}`);
}

/**
 * @param {string | undefined} dbUrl
 * @param {string[]} files
 */
async function resetLocal(dbUrl, files) {
  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();
  try {
    await emptyDatabase(client, files);
  } finally {
    await client.end();
  }
  run(["x", "supabase", "db", "push", "--local", "--yes"], process.env);
}

/**
 * The ref check runs before anything opens a connection.
 * @param {string | undefined} dbUrl
 */
function checkLinkedTarget(dbUrl) {
  checkResetTarget({
    linkedRef: existsSync(LINKED_REF) ? readFileSync(LINKED_REF, "utf8").trim() : undefined,
    envRef: process.env["DEV_SUPABASE_PROJECT_REF"],
    dbUrlUser:
      dbUrl === undefined || dbUrl === "" ? undefined : decodeURIComponent(new URL(dbUrl).username),
  });
  // Checked before anything is emptied: without it the push would wait for a password after the schema is gone.
  const password = process.env["DEV_SUPABASE_DB_PASSWORD"];
  if (password === undefined || password === "")
    throw new Error("refusing: DEV_SUPABASE_DB_PASSWORD is not set");
}

/**
 * @param {string | undefined} dbUrl
 * @param {string[]} files
 * @param {boolean} acceptForeign
 */
async function resetLinked(dbUrl, files, acceptForeign) {
  // In phase 1 only the orchestrator resets, from main (invariant 17, ruling H1).
  if (process.env["MOP_SINGLE_LANE"] !== "1") {
    const branch = findBranchMigrations(files, mainMigrationFiles());
    if (branch.length > 0) throw new Error(`refusing: branch migrations ${branch.join(" ")}`);
  }

  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();
  try {
    // G34: one writer at a time on mop-dev, held for the whole run; the db:push child is told it is held.
    await client.query("select pg_advisory_lock(hashtext('mop-dev-tests'))");
    if (await relationExists(client, "supabase_migrations.schema_migrations")) {
      /** @type {pg.QueryResult<{ version: string }>} */
      const applied = await client.query(
        "select version from supabase_migrations.schema_migrations order by version",
      );
      const foreign = findForeignMigrations(
        applied.rows.map((row) => row.version),
        files,
      );
      if (foreign.length > 0 && !acceptForeign)
        throw new Error(`refusing: foreign migrations ${foreign.join(" ")}`);
      // Once only main pushes (H1), a foreign version is abandoned history; the truncate below removes it.
      if (foreign.length > 0) console.log(`accepting foreign migrations ${foreign.join(" ")}`);
    }
    await emptyDatabase(client, files);
    run(["scripts/db-push.mjs"], { ...process.env, MOP_DEV_LOCK_HELD: "1" });
  } finally {
    await client.end();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const unknown = args.filter((arg) => !FLAGS.includes(arg));
  if (unknown.length > 0) throw new Error(`refusing: unknown arguments ${unknown.join(" ")}`);
  const files = migrationFiles(readdirSync(MIGRATIONS));
  const dbUrl = process.env["DEV_DB_URL"];
  const local = args.includes("--local");
  if (!local) checkLinkedTarget(dbUrl);
  else if (dbUrl === undefined || !isLocalDbUrl(dbUrl))
    throw new Error("refusing: --local needs DEV_DB_URL on 127.0.0.1");
  // Every mode, before the first write (invariant 23, ruling H35 (5)).
  await assertNotProduction({ dbUrl });
  if (local) await resetLocal(dbUrl, files);
  else await resetLinked(dbUrl, files, args.includes("--accept-foreign"));
}

main().catch((/** @type {unknown} */ error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
