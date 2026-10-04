// B9 step 8: the manual trigger of the `render_og_static` job, which uploads a newer set of the static Open Graph
// cards (G5). `bun run scripts/og-static.ts [--pages home,markets,...]` with the dev profile loaded; it enqueues one
// heavy job and prints its id. The runner, the dispatch and the callback are the ones of every heavy job.
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/db/index.ts";
import { ogStaticKeys } from "../src/domain/assets.ts";
import { holdDevLock } from "../tests/fixtures/dev-lock";
import { assertNotProduction } from "./lib/assert-not-production.mjs";
import { guardEnv } from "./lib/guard-env.mjs";

type Key = (typeof ogStaticKeys)[number];

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`og-static: ${name} is not set`);
  return value;
}

/** Built from the dev profile's own names, never SUPABASE_URL, which a shell may hold for another project (P-331). */
function devDb() {
  return createClient<Database>(
    `https://${requiredEnv("DEV_SUPABASE_PROJECT_REF")}.supabase.co`,
    requiredEnv("DEV_SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
type DevDb = ReturnType<typeof devDb>;

function isKey(value: string): value is Key {
  return ogStaticKeys.some((key) => key === value);
}

function parsePages(argv: string[]): Key[] {
  const { values } = parseArgs({ args: argv, options: { pages: { type: "string" } } });
  if (values.pages === undefined) return [...ogStaticKeys];
  const pages = values.pages.split(",").filter((page) => page !== "");
  const unknown = pages.filter((page) => !isKey(page));
  if (pages.length === 0 || unknown.length > 0) {
    throw new Error(`og-static: --pages takes some of ${ogStaticKeys.join(", ")}`);
  }
  return pages.filter(isKey);
}

/** The jobs of today (UTC), counted by key: the job has no entity row, so the date is its entity (B8 invariant 1). */
async function countToday(db: DevDb, day: string): Promise<number> {
  const { count, error } = await db
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .like("idempotency_key", `render_og_static:${day}:%`);
  if (error !== null) throw new Error(`og-static: reading jobs failed: ${error.message}`);
  return count ?? 0;
}

// The envelope of enqueueJob() (src/server/lib/jobs.ts), whose Db type needs the DOM lib that scripts do not load.
async function enqueue(db: DevDb, key: string, pages: Key[]): Promise<string | null> {
  const { data, error } = await db.rpc("enqueue_job", {
    p_type: "render_og_static",
    p_payload: { params: { pages }, data: {} },
    p_idempotency_key: key,
    p_heavy: true,
  });
  if (error !== null) throw new Error(`og-static: enqueue_job failed: ${error.message}`);
  // The generated type says string; enqueue_job answers null when the key already exists (invariant 1).
  return data || null;
}

async function main(): Promise<void> {
  const pages = parsePages(process.argv.slice(2));
  guardEnv();
  await assertNotProduction({ dbUrl: process.env["DEV_DB_URL"] });
  const db = devDb();
  const release = await holdDevLock();
  try {
    const day = new Date().toISOString().slice(0, 10);
    const taken = await countToday(db, day);
    // A concurrent run that took the key answers null: one retry with the next number, then a failure.
    for (const n of [taken + 1, taken + 2]) {
      const id = await enqueue(db, `render_og_static:${day}:${String(n)}`, pages);
      if (id !== null) {
        console.log(id);
        return;
      }
    }
    throw new Error("og-static: two keys of today were taken at once");
  } finally {
    await release();
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
