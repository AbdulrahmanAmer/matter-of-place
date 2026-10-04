// `bun scripts/with-coming-soon.ts --value true|false -- <command...>` (B3b, G34): the one way this plan flips
// `settings.coming_soon_global` on mop-dev. It holds the writer lock for the whole run, sets the value (B2's settings
// trigger moves catalog_version), runs the command and puts back the value it read, on exit and on SIGINT or SIGTERM.
import { spawn, type ChildProcess } from "node:child_process";
import { parseArgs } from "node:util";
import pg from "pg";
import { assertNotProduction } from "./lib/assert-not-production.mjs";

const KEY = "coming_soon_global";
const LOCK = "select pg_advisory_lock(hashtext('mop-dev-tests'))";
const UNLOCK = "select pg_advisory_unlock(hashtext('mop-dev-tests'))";

function parse(argv: string[]): { value: boolean; command: string[] } | undefined {
  const { values, positionals } = parseArgs({
    args: argv,
    options: { value: { type: "string" } },
    allowPositionals: true,
  });
  if ((values.value !== "true" && values.value !== "false") || positionals.length === 0)
    return undefined;
  return { value: values.value === "true", command: positionals };
}

async function readFlag(db: pg.Client): Promise<boolean> {
  const read = await db.query<{ value: unknown }>(
    "select value from public.settings where key = $1",
    [KEY],
  );
  const value = read.rows[0]?.value;
  if (typeof value !== "boolean") throw new Error(`${KEY} is not a boolean row`);
  return value;
}

async function writeFlag(db: pg.Client, value: boolean): Promise<void> {
  await db.query("update public.settings set value = to_jsonb($2::boolean) where key = $1", [
    KEY,
    value,
  ]);
}

let child: ChildProcess | undefined;
let interrupted = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    interrupted = true;
    child?.kill(signal);
  });
}

/** The child takes no lock of its own: this run already holds it (MOP_DEV_LOCK_HELD, G34). */
function run(command: string[]): Promise<number> {
  const [file, ...rest] = command;
  if (interrupted || file === undefined) return Promise.resolve(1);
  return new Promise((done) => {
    child = spawn(file, rest, {
      stdio: "inherit",
      shell: true,
      env: { ...process.env, MOP_DEV_LOCK_HELD: "1" },
    });
    child.on("exit", (code) => {
      done(code ?? 1);
    });
  });
}

async function main(): Promise<number> {
  const args = parse(process.argv.slice(2));
  if (args === undefined) {
    console.error("usage: bun scripts/with-coming-soon.ts --value true|false -- <command...>");
    return 2;
  }
  await assertNotProduction();
  const db = new pg.Client({ connectionString: process.env["DEV_DB_URL"] });
  await db.connect();
  try {
    await db.query(LOCK);
    try {
      const original = await readFlag(db);
      let code = 1;
      try {
        await writeFlag(db, args.value);
        code = await run(args.command);
      } finally {
        await writeFlag(db, original);
        const restored = await readFlag(db);
        console.log(`${KEY} restored to ${String(restored)}`);
        if (restored !== original) code = 1;
      }
      return code;
    } finally {
      await db.query(UNLOCK);
    }
  } finally {
    await db.end();
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  },
);
