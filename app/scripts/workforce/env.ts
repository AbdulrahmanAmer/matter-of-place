// The laptop runner's settings: the few names it needs from the workspace `.env`, loaded into process.env when absent.
// Values are never printed. Shared by the daemon and the weekly review.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const NAMES = [
  "DEV_SUPABASE_PROJECT_REF",
  "DEV_SUPABASE_SERVICE_ROLE_KEY",
  "WORKFORCE_CLI",
  "MATTER_AGENT_KEY",
];

export function loadEnvFile(): void {
  const file = resolve(import.meta.dir, "../../../.env");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (match === null) continue;
    const [, name = "", raw = ""] = match;
    if (!NAMES.includes(name)) continue;
    if (process.env[name] === undefined) process.env[name] = raw.replace(/^"(.*)"$/, "$1");
  }
}
