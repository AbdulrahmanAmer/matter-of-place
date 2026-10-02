// `bun run db:reset`: the no-Docker stand-in for `supabase db reset` on mop-dev (S50, B2 Files).
// Empties `public`, drops the pgmq queues, unschedules the cron jobs the migrations create, then pushes every
// migration from zero. The ref check runs before anything opens a connection.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { assertNotProduction } from "./lib/assert-not-production.mjs";
import { checkResetTarget, cronJobNames, findForeignMigrations } from "./lib/reset-guard.mjs";

const APP = fileURLToPath(new URL("..", import.meta.url));
const MIGRATIONS = fileURLToPath(new URL("../supabase/migrations/", import.meta.url));
const LINKED_REF = fileURLToPath(new URL("../supabase/.temp/project-ref", import.meta.url));

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

async function main() {
  const dbUrl = process.env["DEV_DB_URL"];
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
  await assertNotProduction({ dbUrl });

  const files = readdirSync(MIGRATIONS)
    .filter((file) => file.endsWith(".sql"))
    .sort();
  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();
  try {
    // G34: one writer at a time on mop-dev, held for the whole run.
    await client.query("select pg_advisory_lock(hashtext('mop-dev-tests'))");
    const history = await relationExists(client, "supabase_migrations.schema_migrations");
    if (history) {
      /** @type {pg.QueryResult<{ version: string }>} */
      const applied = await client.query(
        "select version from supabase_migrations.schema_migrations order by version",
      );
      const foreign = findForeignMigrations(
        applied.rows.map((row) => row.version),
        files,
      );
      if (foreign.length > 0) throw new Error(`refusing: foreign migrations ${foreign.join(" ")}`);
    }

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
    // Dropping the schema also drops Supabase's default privileges on it: every grant comes from migration 10.
    await client.query("drop schema public cascade");
    await client.query("create schema public");
    await client.query("grant usage on schema public to anon, authenticated, service_role");
    await client.query("grant all on schema public to postgres");
    if (history) await client.query("truncate supabase_migrations.schema_migrations");
    await client.query("commit");

    // STUB(B2 step 1b): `bun scripts/db-push.mjs` with MOP_DEV_LOCK_HELD=1 replaces this bare push (invariant 17).
    const push = spawnSync(process.execPath, ["x", "supabase", "db", "push", "--linked"], {
      cwd: APP,
      stdio: "inherit",
      env: { ...process.env, SUPABASE_DB_PASSWORD: password },
    });
    if (push.status !== 0) throw new Error(`supabase db push exited ${String(push.status)}`);
  } finally {
    await client.end();
  }
}

main().catch((/** @type {unknown} */ error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
