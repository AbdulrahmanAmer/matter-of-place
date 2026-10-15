// The laptop runner's settings: the few names it needs from the workspace `.env`, loaded into process.env when absent.
// Values are never printed. Shared by the daemon and the weekly review.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../src/db/index.ts";
import type { Db } from "../../src/server/lib/db.ts";

const NAMES = [
  "DEV_SUPABASE_PROJECT_REF",
  "DEV_SUPABASE_SERVICE_ROLE_KEY",
  "WORKFORCE_CLI",
  "MATTER_AGENT_KEY",
];

export function loadEnvFile(file = resolve(import.meta.dir, "../../../.env")): void {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (match === null) continue;
    const [, name = "", raw = ""] = match;
    if (!NAMES.includes(name)) continue;
    if (process.env[name] === undefined) process.env[name] = raw.replace(/^"(.*)"$/, "$1");
  }
}

/** The project's database under the service role, from the workspace `.env`. */
export function serviceDb(): Db {
  loadEnvFile();
  const ref = process.env["DEV_SUPABASE_PROJECT_REF"];
  const key = process.env["DEV_SUPABASE_SERVICE_ROLE_KEY"];
  if (ref === undefined || key === undefined)
    throw new Error("workforce: the .env names of the project are missing");
  return createClient<Database>(`https://${ref}.supabase.co`, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** What a Claude CLI child may see: no CLAUDE* variables, no project keys, no secret, key or token (Jay's lessons). */
export function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (name.startsWith("CLAUDE") || name.startsWith("DEV_SUPABASE") || name.includes("SECRET"))
      continue;
    if (name.endsWith("_KEY") || name.endsWith("_TOKEN")) continue;
    env[name] = value;
  }
  return env;
}
