// `bun run scripts/invoice-smoke.ts` (B6): the invoice path on the one database, before L1's launch switch only
// (ruling H35 (5)). It checks readiness first with the same `invoiceReadiness` the issue path uses and, when
// something is missing, writes nothing, prints `invoice_not_ready: <fields>` and exits 1. From `app/`:
//   eval "$(node scripts/load-env.mjs --profile dev)"; env -u CLOUDFLARE_API_TOKEN bun run scripts/invoice-smoke.ts
import { createClient } from "@supabase/supabase-js";
import type { Db } from "../src/server/lib/db.ts";
import { invoiceReadiness, readInvoiceInputs } from "../src/server/payments/invoice-settings.ts";
import { holdDevLock } from "../tests/fixtures/dev-lock.ts";
import { assertNotProduction } from "./lib/assert-not-production.mjs";
import { guardEnv } from "./lib/guard-env.mjs";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`invoice-smoke: ${name} is not set`);
  return value;
}

async function main(): Promise<number> {
  guardEnv();
  await assertNotProduction({ dbUrl: process.env["DEV_DB_URL"] });
  // The dev profile's own names, never SUPABASE_URL (P-331); the key is read here and never printed (E10).
  const db: Db = createClient(
    `https://${requiredEnv("DEV_SUPABASE_PROJECT_REF")}.supabase.co`,
    requiredEnv("DEV_SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const release = await holdDevLock();
  try {
    const { site, invoice } = await readInvoiceInputs(db);
    const missing = invoiceReadiness(site, invoice);
    if (missing.length > 0) {
      console.log(`invoice_not_ready: ${missing.join(", ")}`);
      return 1;
    }
    // STUB(B6 step 5): the fixture submission, `issueInvoiceCore`, `--out`, `--cleanup` and `--print-text` follow here
    console.log("ready");
    return 0;
  } finally {
    await release();
  }
}

if (import.meta.main) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    },
  );
}
