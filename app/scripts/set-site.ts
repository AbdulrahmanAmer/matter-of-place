// `bun run scripts/set-site.ts --file <json>` (B16 step 2): writes `settings.site` on the one database through
// `settings_put_site`, before L1's launch switch only (ruling H35 (5)); after it, screen 24 is the only writer. Run it
// with the dev profile loaded (`eval "$(node scripts/load-env.mjs --profile dev)"`); no value is ever printed. A
// failed call changed nothing, so the operator runs the same command again.
import { guardEnv } from "./lib/guard-env.mjs";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/db/index.ts";
import { AppError } from "../src/server/lib/errors.ts";
import { siteReadiness } from "../src/server/settings/readiness.ts";
import { applySiteSettings } from "../src/server/settings/service.ts";
import { holdDevLock } from "../tests/fixtures/dev-lock.ts";
import { assertNotProduction } from "./lib/assert-not-production.mjs";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`set-site: ${name} is not set`);
  return value;
}

/** A consistency check, not the production check: the lock and the write must reach the same project. */
function assertDevUser(dbUrl: string, ref: string): void {
  if (decodeURIComponent(new URL(dbUrl).username) !== `postgres.${ref}`) {
    throw new Error("refusing: DEV_DB_URL does not name the user of DEV_SUPABASE_PROJECT_REF");
  }
}

async function main(): Promise<void> {
  guardEnv();
  const { values } = parseArgs({ options: { file: { type: "string" } } });
  if (values.file === undefined) throw new Error("usage: set-site --file <json>");
  const ref = requiredEnv("DEV_SUPABASE_PROJECT_REF");
  const key = requiredEnv("DEV_SUPABASE_SERVICE_ROLE_KEY");
  const dbUrl = requiredEnv("DEV_DB_URL");
  const input: unknown = JSON.parse(readFileSync(values.file, "utf8"));

  assertDevUser(dbUrl, ref);
  await assertNotProduction({ dbUrl });
  const release = await holdDevLock();
  try {
    const db = createClient<Database>(`https://${ref}.supabase.co`, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    try {
      await applySiteSettings(db, input, { id: null, kind: "human", note: "script: set-site" });
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      const paths = error.issues?.map((issue) => issue.path.join(".")) ?? [];
      console.error(`set-site: ${error.code}${paths.length > 0 ? ` ${paths.join(" ")}` : ""}`);
      process.exitCode = 1;
      return;
    }
    const missing = await siteReadiness(db);
    console.log(`missing: ${missing.length > 0 ? missing.join(" ") : "none"}`);
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
