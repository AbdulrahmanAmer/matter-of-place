// `bun scripts/with-maintenance.ts --value true|false -- <command...>` (B17 step 6, ASSUMED G34): the one way this plan
// flips `settings.flags.maintenance` on mop-dev, before L1's launch switch only (ruling H35 (5)). It holds the writer
// lock, sets the flag (B2's settings trigger moves catalog_version), runs the command without a shell, and puts back
// the value it read in a `finally`, on SIGINT and SIGTERM too. Nothing is retried.
import { spawn, type ChildProcess } from "node:child_process";
import { parseArgs } from "node:util";
import pg from "pg";
import { pgClientConfig } from "./lib/pg-connect.mjs";
import { assertNotProduction } from "./lib/assert-not-production.mjs";

const READ_FLAG =
  "select value -> 'maintenance' as maintenance from public.settings where key = 'flags'";
const SET_FLAG =
  "update public.settings set value = jsonb_set(value, '{maintenance}', to_jsonb($1::boolean)) where key = 'flags'";
const DROP_FLAG = "update public.settings set value = value - 'maintenance' where key = 'flags'";

/** The stored value, or null when the flags row has no `maintenance` key (which reads as false). */
async function readMaintenance(client: pg.Client): Promise<boolean | null> {
  const { rows } = await client.query<{ maintenance: unknown }>(READ_FLAG);
  const row = rows[0];
  if (row === undefined) throw new Error("settings has no flags row");
  if (row.maintenance !== null && typeof row.maintenance !== "boolean") {
    throw new Error("flags.maintenance is not a boolean");
  }
  return row.maintenance;
}

async function writeMaintenance(client: pg.Client, value: boolean | null): Promise<void> {
  const result =
    value === null ? await client.query(DROP_FLAG) : await client.query(SET_FLAG, [value]);
  if (result.rowCount !== 1) throw new Error("the flags row was not updated");
}

/** A consistency check, not the production check: the URL must name the dev project's pooler user. */
function assertDevUser(dbUrl: string): void {
  const ref = process.env["DEV_SUPABASE_PROJECT_REF"] ?? "";
  const user = decodeURIComponent(new URL(dbUrl).username);
  if (ref === "" || user !== `postgres.${ref}`) {
    throw new Error("refusing: DEV_DB_URL does not name the user of DEV_SUPABASE_PROJECT_REF");
  }
}

let running: ChildProcess | undefined;
let stopped = false;
process.on("SIGINT", () => {
  stopped = true;
  running?.kill("SIGINT");
});
process.on("SIGTERM", () => {
  stopped = true;
  running?.kill("SIGTERM");
});

/** The command inherits this run's lock (MOP_DEV_LOCK_HELD, G34) and its exit code becomes the run's. */
function runCommand([program, ...programArgs]: string[]): Promise<number> {
  if (stopped || program === undefined) return Promise.resolve(1);
  return new Promise((resolve) => {
    running = spawn(program, programArgs, {
      stdio: "inherit",
      env: { ...process.env, MOP_DEV_LOCK_HELD: "1" },
    });
    running.on("error", (error) => {
      console.error(error.message);
      resolve(1);
    });
    running.on("exit", (code) => {
      resolve(code ?? 1);
    });
  });
}

async function withFlag(client: pg.Client, value: boolean, command: string[]): Promise<number> {
  const before = await readMaintenance(client);
  // A run cancelled while it waited for the lock never flips the shared flag.
  if (stopped) return 1;
  let exitCode = 1;
  try {
    await writeMaintenance(client, value);
    exitCode = await runCommand(command);
  } finally {
    await writeMaintenance(client, before);
    const after = await readMaintenance(client);
    console.log(`maintenance restored to ${String(after ?? false)}`);
    if (after !== before) exitCode = 1;
  }
  return exitCode;
}

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: { value: { type: "string" } },
    allowPositionals: true,
  });
  if ((values.value !== "true" && values.value !== "false") || positionals.length === 0) {
    console.error("usage: bun scripts/with-maintenance.ts --value true|false -- <command...>");
    return 2;
  }
  const dbUrl = process.env["DEV_DB_URL"] ?? "";
  await assertNotProduction({ dbUrl });
  assertDevUser(dbUrl);
  const client = new pg.Client(pgClientConfig(dbUrl));
  await client.connect();
  try {
    await client.query("select pg_advisory_lock(hashtext('mop-dev-tests'))");
    try {
      return await withFlag(client, values.value === "true", positionals);
    } finally {
      await client.query("select pg_advisory_unlock(hashtext('mop-dev-tests'))");
    }
  } finally {
    await client.end();
  }
}

process.exitCode = await main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  return 1;
});
