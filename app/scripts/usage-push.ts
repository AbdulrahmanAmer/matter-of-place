// `bun run scripts/usage-push.ts`: measures the dashboard's vendor lines on the operator's laptop and records them
// (operator, 2026-10-12: "fix this issue we have with things being not measured for those rows"). The tokens that can
// count Workers requests, Sentry errors and GitHub Actions minutes live in the laptop's `.env` and never become Worker
// secrets, so the measuring runs here, through the weekly audit's own collectors, and the Worker only reads the
// result (`vendor_usage`). Supabase egress has no API an account token can read (measured 2026-10-12: the billing
// usage answers 401, the logs endpoint has no edge table); Matter records it from the signed-in dashboard (W2
// invariant 8). Runs daily from the "MOP Usage" scheduled task (scripts/workforce/install.ps1).
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { makeContext } from "../../workspace/audits/tools/common.mjs";
import { vendorRows } from "../../workspace/audits/tools/usage.mjs";
import type { Database } from "../src/db/types.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../..");

/** The `.env` files of the workspace, read by name; a value is never printed. */
function laptopEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const file of [join(root, ".env"), join(root, "app/.env"), join(root, ".env.ops")]) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const match = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      const name = match?.[1];
      const value = match?.[2];
      if (name !== undefined && value !== undefined && env[name] === undefined) {
        env[name] = value.replace(/^["']|["']$/g, "");
      }
    }
  }
  return env;
}

/** The lines of the gauges, by the collector's own names. */
const LINES = ["workers_requests_day", "sentry_errors", "actions_minutes"] as const;

/** A public repository's Actions minutes are free and unlimited; the 2,000 minute limit is for private ones. */
function repositoryIsPublic(): boolean {
  const answer = spawnSync(
    "gh",
    [
      "repo",
      "view",
      "AbdulrahmanAmer/matter-of-place",
      "--json",
      "visibility",
      "--jq",
      ".visibility",
    ],
    { encoding: "utf8", timeout: 60_000 },
  );
  return answer.stdout.trim() === "PUBLIC";
}

async function main(): Promise<void> {
  const env = laptopEnv();
  const ref = env["DEV_SUPABASE_PROJECT_REF"];
  const key = env["DEV_SUPABASE_SERVICE_ROLE_KEY"];
  if (ref === undefined || key === undefined) {
    throw new Error(
      "usage-push: DEV_SUPABASE_PROJECT_REF or DEV_SUPABASE_SERVICE_ROLE_KEY is not in .env",
    );
  }
  const rows = await vendorRows(
    makeContext({ env: { ...process.env, ...env }, siteUrl: "https://matterofplace.com" }),
  );
  const db = createClient<Database>(`https://${ref}.supabase.co`, key, {
    auth: { persistSession: false },
  });
  const open = repositoryIsPublic();
  for (const name of LINES) {
    const row = rows.find((candidate) => candidate.line === name);
    if (row === undefined || row.used === null) {
      console.log(`usage-push: ${name} not measured (${row?.reason ?? "no collector row"})`);
      continue;
    }
    const publicMinutes = name === "actions_minutes" && open;
    const { error } = await db.rpc("record_vendor_usage", {
      p_line: name,
      p_used: row.used,
      ...(publicMinutes || row.limit === null ? {} : { p_limit: row.limit }),
      ...(publicMinutes ? { p_note: "public repository, not limited" } : {}),
    });
    console.log(
      `usage-push: ${name} ${error === null ? "recorded" : `refused (${error.message})`}`,
    );
  }
}

await main();
