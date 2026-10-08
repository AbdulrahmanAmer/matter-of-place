// `bun run scripts/set-invoice.ts --file <json>` (B6 step 4): validates a `settings.invoice` file and applies it
// through `settings_put_invoice` until screen 24 exists, then prints `ready` or `missing: <fields>` from the same
// `invoiceReadiness` the issue path uses. It applies test fixtures to the one database, so it refuses once
// `settings.environment` is `production`. From `app/`:
//   eval "$(node scripts/load-env.mjs --profile dev)"; env -u CLOUDFLARE_API_TOKEN bun run scripts/set-invoice.ts --file scripts/fixtures/invoice.example.json
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";
import type { Db } from "../src/server/lib/db.ts";
import { AppError } from "../src/server/lib/errors.ts";
import {
  applyInvoiceSettings,
  invoiceReadiness,
  readInvoiceInputs,
} from "../src/server/payments/invoice-settings.ts";
import { holdDevLock } from "../tests/fixtures/dev-lock.ts";
import { assertNotProduction } from "./lib/assert-not-production.mjs";
import { guardEnv } from "./lib/guard-env.mjs";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`set-invoice: ${name} is not set`);
  return value;
}

/** The code and, for a refused file, each issue as `path: message`. */
function describe(error: unknown): string {
  if (!(error instanceof AppError)) return error instanceof Error ? error.message : String(error);
  const issues = (error.issues ?? []).map((issue) => `${issue.path.join(".")}: ${issue.message}`);
  return [`${error.code}: ${error.message}`, ...issues].join("\n");
}

async function main(): Promise<number> {
  guardEnv();
  const { file } = parseArgs({
    args: process.argv.slice(2),
    options: { file: { type: "string" } },
  }).values;
  if (file === undefined) {
    console.error("usage: set-invoice.ts --file <json>");
    return 2;
  }
  await assertNotProduction({ dbUrl: process.env["DEV_DB_URL"] });
  const input: unknown = JSON.parse(readFileSync(file, "utf8"));
  // The dev profile's own names, never SUPABASE_URL (P-331); the key is read here and never printed (E10).
  const db: Db = createClient(
    `https://${requiredEnv("DEV_SUPABASE_PROJECT_REF")}.supabase.co`,
    requiredEnv("DEV_SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const release = await holdDevLock();
  try {
    await applyInvoiceSettings(db, input, {
      id: null,
      kind: "human",
      requestId: `set-invoice:${new Date().toISOString()}`,
      note: "script: set-invoice",
    });
    const { site, invoice } = await readInvoiceInputs(db);
    const missing = invoiceReadiness(site, invoice);
    console.log(missing.length === 0 ? "ready" : `missing: ${missing.join(", ")}`);
  } finally {
    await release();
  }
  return 0;
}

if (import.meta.main) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      console.error(describe(error));
      process.exitCode = 1;
    },
  );
}
