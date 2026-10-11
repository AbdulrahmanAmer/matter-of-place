// `bun run db:push`: the one path for migrations to mop-dev (B2 invariant 17, ruling H1, DB-01, E2E-06, DO-05).
// It refuses branch, remote-only, out-of-order and edited migrations before the CLI runs, and records each applied
// file's sha256 after it. Forward migrations from main are the one schema write allowed after the launch switch, so it
// never calls assertNotProduction, and it never imports guard-env.mjs: B1b's deploy job runs it beside ops names.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { pgClientConfig } from "./lib/pg-connect.mjs";
import {
  findBranchMigrations,
  findChecksumDrift,
  findForeignMigrations,
  findOutOfOrder,
  migrationFiles,
  migrationVersion,
  shouldCheckBranch,
} from "./lib/push-guard.mjs";
import { checkResetTarget } from "./lib/reset-guard.mjs";

const APP = fileURLToPath(new URL("..", import.meta.url));
const MIGRATIONS = fileURLToPath(new URL("../supabase/migrations/", import.meta.url));
const LINKED_REF = fileURLToPath(new URL("../supabase/.temp/project-ref", import.meta.url));
// Session pooler of mop-dev (ASSUMED E4); CI has no DEV_DB_URL and builds the URL from the ref and the password.
const POOLER = "aws-0-us-east-1.pooler.supabase.com:5432";

/**
 * @typedef {{ version: string, sha256: string }} Checksum
 * @typedef {object} PushDatabase
 * @property {() => Promise<string | null>} environment `settings.environment`; null without the table or the row
 * @property {() => Promise<void>} lock
 * @property {() => Promise<{ versions: string[], checksums: Checksum[] }>} history
 * @property {(rows: Checksum[]) => Promise<void>} record
 * @property {() => Promise<void>} end
 * @typedef {object} PushIo
 * @property {Record<string, string | undefined>} env
 * @property {string | undefined} linkedRef
 * @property {{ file: string, sha256: string }[]} local the local migration files with the sha256 of their bytes
 * @property {() => string[]} mainFiles the migration file names on origin/main
 * @property {(dbUrl: string) => Promise<PushDatabase>} connect
 * @property {(args: string[], env: Record<string, string | undefined>) => number} supabase runs the CLI, returns its exit status
 */

/**
 * @param {Checksum[]} checksums
 * @param {string[]} versions
 * @param {PushIo["local"]} local
 * @returns {string[]}
 */
function historyRefusals(checksums, versions, local) {
  const files = local.map(({ file }) => file);
  const foreign = findForeignMigrations(versions, files);
  return [
    ...(foreign.length > 0
      ? [`refusing: remote-only migrations ${foreign.join(" ")} (rebase onto origin/main first)`]
      : []),
    ...findOutOfOrder(versions, files).map(
      (file) =>
        `refusing: out-of-order migration ${file} (regenerate the timestamp with supabase migration new)`,
    ),
    ...findChecksumDrift(checksums, local).map(
      (version) =>
        `refusing: edited migration ${version} (an applied migration is never edited; add a new one)`,
    ),
  ];
}

/**
 * @param {PushIo} io
 */
export async function pushMigrations(io) {
  const { env } = io;
  const ref = env["DEV_SUPABASE_PROJECT_REF"];
  const password = env["DEV_SUPABASE_DB_PASSWORD"];
  if (password === undefined || password === "")
    throw new Error("refusing: DEV_SUPABASE_DB_PASSWORD is not set");
  const given = env["DEV_DB_URL"];
  const dbUrl =
    given === undefined || given === ""
      ? `postgresql://postgres.${ref ?? ""}:${encodeURIComponent(password)}@${POOLER}/postgres`
      : given;
  checkResetTarget({
    linkedRef: io.linkedRef,
    envRef: ref,
    dbUrlUser: decodeURIComponent(new URL(dbUrl).username),
  });

  const db = await io.connect(dbUrl);
  try {
    const environment = await db.environment();
    const files = io.local.map(({ file }) => file);
    if (shouldCheckBranch({ singleLane: env["MOP_SINGLE_LANE"] === "1", environment })) {
      const branch = findBranchMigrations(files, io.mainFiles());
      if (branch.length > 0) throw new Error(`refusing: branch migrations ${branch.join(" ")}`);
    }
    // G34: one writer at a time on mop-dev; db:reset holds the lock itself and says so with MOP_DEV_LOCK_HELD.
    if (env["MOP_DEV_LOCK_HELD"] !== "1") await db.lock();
    const before = await db.history();
    const refusals = historyRefusals(before.checksums, before.versions, io.local);
    if (refusals.length > 0) throw new Error(refusals.join("\n"));

    const cliEnv = { ...env, SUPABASE_DB_PASSWORD: password };
    if (io.supabase(["db", "push", "--linked", "--dry-run"], cliEnv) !== 0)
      throw new Error("supabase db push --dry-run failed");
    if (io.supabase(["db", "push", "--linked", "--yes"], cliEnv) !== 0)
      throw new Error("supabase db push failed");

    const applied = new Set((await db.history()).versions);
    const rows = io.local.flatMap(({ file, sha256 }) => {
      const version = migrationVersion(file);
      return version !== undefined && applied.has(version) ? [{ version, sha256 }] : [];
    });
    if (rows.length > 0) await db.record(rows);
  } finally {
    await db.end();
  }
}

/**
 * The migration file names on origin/main; db:reset runs the same branch check before it empties anything.
 * @returns {string[]}
 */
export function mainMigrationFiles() {
  const result = spawnSync(
    "git",
    ["ls-tree", "--name-only", "origin/main", "supabase/migrations/"],
    {
      cwd: APP,
      encoding: "utf8",
    },
  );
  if (result.status !== 0)
    throw new Error(`git ls-tree origin/main failed: ${result.stderr.trim()}`);
  return migrationFiles(result.stdout.split("\n"));
}

/**
 * @param {string} dbUrl
 * @returns {Promise<PushDatabase>}
 */
async function connect(dbUrl) {
  const client = new pg.Client(pgClientConfig(dbUrl));
  await client.connect();
  /** @param {string} name */
  const exists = async (name) => {
    /** @type {pg.QueryResult<{ found: boolean }>} */
    const result = await client.query("select to_regclass($1) is not null as found", [name]);
    return result.rows[0]?.found === true;
  };
  return {
    environment: async () => {
      if (!(await exists("public.settings"))) return null;
      /** @type {pg.QueryResult<{ value: string | null }>} */
      const result = await client.query(
        "select value #>> '{}' as value from public.settings where key = 'environment'",
      );
      return result.rows[0]?.value ?? null;
    },
    lock: async () => {
      await client.query("select pg_advisory_lock(hashtext('mop-dev-tests'))");
    },
    // A database no migration has reached has neither table: that reads as empty history.
    history: async () => {
      /** @type {string[]} */
      let versions = [];
      if (await exists("supabase_migrations.schema_migrations")) {
        /** @type {pg.QueryResult<{ version: string }>} */
        const result = await client.query(
          "select version from supabase_migrations.schema_migrations",
        );
        versions = result.rows.map((row) => row.version);
      }
      /** @type {Checksum[]} */
      let checksums = [];
      if (await exists("public.migration_checksums")) {
        /** @type {pg.QueryResult<Checksum>} */
        const result = await client.query("select version, sha256 from public.migration_checksums");
        checksums = result.rows;
      }
      return { versions, checksums };
    },
    record: async (rows) => {
      await client.query(
        "insert into public.migration_checksums (version, sha256) select * from unnest($1::text[], $2::text[]) on conflict (version) do update set sha256 = excluded.sha256",
        [rows.map((row) => row.version), rows.map((row) => row.sha256)],
      );
    },
    end: () => client.end(),
  };
}

if (import.meta.main) {
  pushMigrations({
    env: process.env,
    linkedRef: existsSync(LINKED_REF) ? readFileSync(LINKED_REF, "utf8").trim() : undefined,
    local: migrationFiles(readdirSync(MIGRATIONS)).map((file) => ({
      file,
      sha256: createHash("sha256")
        .update(readFileSync(`${MIGRATIONS}${file}`))
        .digest("hex"),
    })),
    mainFiles: mainMigrationFiles,
    connect,
    supabase: (args, env) =>
      spawnSync(process.execPath, ["x", "supabase", ...args], { cwd: APP, stdio: "inherit", env })
        .status ?? 1,
  }).catch((/** @type {unknown} */ error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
