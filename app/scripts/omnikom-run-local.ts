// B15 step 5a: runs the `webhook_omnikom` step in this process against the local mock (`bun run omnikom:mock`), on a
// real inquiry of mop-dev, so the step is exercised without a tunnel. `bun run omnikom:run-local -- --latest | --id <uuid>`
// with the dev profile loaded. It marks the inquiry forwarded: a test write, refused once the database is production
// (ruling H35 (5)).
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "../src/db/index.ts";
import { webhookOmnikom } from "../src/server/jobs/steps/webhook-omnikom.ts";
import { NonRetryableError, type StepContext } from "../src/server/jobs/types.ts";
import { logLine } from "../src/server/lib/log.ts";
import { holdDevLock } from "../tests/fixtures/dev-lock";
import { assertNotProduction } from "./lib/assert-not-production.mjs";

const MOCK_URL = "http://127.0.0.1:8787";
const STEP_TIMEOUT_MS = 20_000;
const USAGE = "usage: bun run omnikom:run-local -- --latest | --id <uuid>";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`omnikom-run-local: ${name} is not set`);
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

/** `undefined` means the latest inquiry. */
function parseTarget(args: string[]): { id: string | undefined } {
  const { values } = parseArgs({
    args,
    options: { latest: { type: "boolean" }, id: { type: "string" } },
  });
  if (values.latest === true && values.id === undefined) return { id: undefined };
  const id = z.string().uuid().safeParse(values.id);
  if (values.latest !== true && id.success) return { id: id.data };
  throw new Error(USAGE);
}

async function pickInquiry(db: DevDb, id: string | undefined): Promise<string> {
  const rows = db.from("inquiries").select("id");
  const { data, error } =
    id === undefined
      ? await rows.order("received_at", { ascending: false }).limit(1)
      : await rows.eq("id", id);
  if (error !== null)
    throw new Error(`omnikom-run-local: reading inquiries failed: ${error.message}`);
  const row = data[0];
  if (row === undefined) throw new Error("omnikom-run-local: no such inquiry on mop-dev");
  return row.id;
}

/** The result as the job row would hold it, without the stored body bytes. */
function withoutBody(result: unknown): unknown {
  if (typeof result !== "object" || result === null || Array.isArray(result)) return result;
  return Object.fromEntries(Object.entries(result).filter(([key]) => key !== "body"));
}

async function main(): Promise<void> {
  const { id } = parseTarget(process.argv.slice(2));
  await assertNotProduction({ dbUrl: process.env["DEV_DB_URL"] });
  const secret = requiredEnv("OMNIKOM_MOCK_SECRET");
  const release = await holdDevLock();
  try {
    const db = devDb();
    const inquiryId = await pickInquiry(db, id);
    const ctx: StepContext = {
      db,
      env: { OMNIKOM_WEBHOOK_URL: MOCK_URL, OMNIKOM_WEBHOOK_SECRET: secret },
      log: logLine,
      now: new Date(),
      signal: AbortSignal.timeout(STEP_TIMEOUT_MS),
      report: () => Promise.resolve(),
      job: {
        id: "local",
        type: "webhook_omnikom",
        attempts: 1,
        claim: "local",
        result: null,
        eventId: null,
      },
    };
    try {
      const outcome = await webhookOmnikom.run(ctx, {}, { inquiry_id: inquiryId });
      const when =
        outcome.status === "retry_at" ? ` ${outcome.at.toISOString()} ${outcome.reason}` : "";
      console.log(`${outcome.status}${when} ${JSON.stringify(withoutBody(outcome.result))}`);
    } catch (error) {
      if (!(error instanceof NonRetryableError)) throw error;
      console.log(`dead ${error.message}`);
      process.exitCode = 1;
    }
  } finally {
    await release();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
