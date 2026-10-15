// Matter reads the admin with his own key (operator, 2026-10-15: he decides colleagues' work in Approvals, so he must
// see it). usage: bun scripts/matter/read.ts /api/admin/workforce/approvals
// Only GET, only paths under /api/admin/; the key is read from the laptop's env file and never printed.
import { dirname, join } from "node:path";
import { loadEnvFile } from "../workforce/env.ts";
import { ADMIN_BASE } from "./actions.ts";
import { DESK } from "./run.ts";

/**
 * The path a read may use: an admin API path, no traversal; null when refused. Git Bash turns a leading
 * `/api/admin/x` into `C:/Program Files/Git/api/admin/x` (P-3465), so the admin path is taken from where it starts.
 */
export function readablePath(arg: string | undefined): string | null {
  const at = arg?.replace(/\\/g, "/").indexOf("/api/admin/") ?? -1;
  if (arg === undefined || at < 0) return null;
  const path = arg.replace(/\\/g, "/").slice(at);
  return path.includes("..") || /\s/.test(path) ? null : path;
}

async function main(): Promise<void> {
  const path = readablePath(process.argv[2]);
  if (path === null) {
    console.error("usage: bun scripts/matter/read.ts /api/admin/<path> (GET only)");
    process.exitCode = 2;
    return;
  }
  // Matter's session gets no keys (childEnv); run from his desk, the key is in the runner folder's env file beside it.
  loadEnvFile();
  loadEnvFile(join(dirname(DESK), "live", ".env"));
  const key = process.env["MATTER_AGENT_KEY"];
  if (key === undefined || key === "") {
    console.error("This laptop holds no Matter key.");
    process.exitCode = 1;
    return;
  }
  const response = await fetch(`${ADMIN_BASE}${path}`, {
    headers: { authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(20_000),
  });
  console.log(await response.text());
  if (!response.ok) process.exitCode = 1;
}

if (import.meta.main) await main();
