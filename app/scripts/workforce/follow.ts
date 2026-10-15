// Gap audit item 6: the runner folder follows main by itself. Between runs (none in flight), a pass fetches and moves
// the runner to origin/main, and installs packages when bun.lock changed. It acts only on the folder install.ps1
// registered (~/.mop-workforce/runner-app), never on a working copy someone builds in (P-538), and never over local
// changes. The pass that moves keeps its loaded code; the next pass, a minute later, runs the new one.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type Followed =
  | "not the runner"
  | "no fetch"
  | "kept local changes"
  | "unchanged"
  | "moved"
  | "moved and installed"
  | "moved, install failed";

const same = (a: string, b: string) =>
  resolve(a).replaceAll("\\", "/").toLowerCase() === resolve(b).replaceAll("\\", "/").toLowerCase();

/** `app` is the runner's app folder; `marker` the file install.ps1 wrote with that folder's path. */
/** The worker name Matter's live session writes on its own runs (`scripts/matter/live.ts`). */
export const LIVE_WORKER_PREFIX = "matter-live@";

/**
 * Whether a running run keeps the runner from moving to the newest main: only a run this checkout executes. The live
 * session's goal run holds a six-hour lease and runs in its own process, so counting it kept the runner on old code for
 * the whole session (2026-10-15: PRs 431 and 432 merged and the runner stayed behind for hours).
 */
export function runnerBusy(running: readonly { worker: string | null }[]): boolean {
  return running.some((run) => !(run.worker ?? "").startsWith(LIVE_WORKER_PREFIX));
}

export function followMain(app: string, marker: string): Followed {
  if (!existsSync(marker) || !same(readFileSync(marker, "utf8").trim(), app))
    return "not the runner";
  const root = dirname(resolve(app));
  const git = (...args: string[]) =>
    spawnSync("git", ["-C", root, ...args], { windowsHide: true, encoding: "utf8" });
  if (git("fetch", "-q", "origin", "main").status !== 0) return "no fetch";
  const status = git("status", "--porcelain", "--untracked-files=no");
  if (status.status !== 0 || status.stdout.trim() !== "") return "kept local changes";
  const head = git("rev-parse", "HEAD").stdout.trim();
  const target = git("rev-parse", "origin/main").stdout.trim();
  if (target === "" || head === target) return "unchanged";
  const lockBefore = git("rev-parse", "HEAD:app/bun.lock").stdout.trim();
  if (git("checkout", "-q", "--detach", "origin/main").status !== 0) return "unchanged";
  if (git("rev-parse", "HEAD:app/bun.lock").stdout.trim() === lockBefore) return "moved";
  const install = spawnSync("bun", ["install", "--frozen-lockfile"], {
    cwd: resolve(app),
    windowsHide: true,
    encoding: "utf8",
  });
  return install.status === 0 ? "moved and installed" : "moved, install failed";
}

/** W6 item 3: Matter's system map is written again after each move the runner can run, and whenever it is missing. */
export function mapDue(followed: Followed, mapExists: boolean): boolean {
  if (followed === "not the runner" || followed === "moved, install failed") return false;
  return followed === "moved" || followed === "moved and installed" || !mapExists;
}
