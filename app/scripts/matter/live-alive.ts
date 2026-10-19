// W5: whether Matter's live supervisor is up, read by the one-shot runner (which then leaves the operator's lines to
// it) and written by the supervisor. Its own file so the runner never imports the supervisor.
import { statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const HEARTBEAT_FILE = join(homedir(), ".mop-workforce", "matter", "live.heartbeat");
const ALIVE_MS = 60_000;

/**
 * How long the supervisor's loop may go without writing its heartbeat before its watchdog ends the process, so the
 * scheduled task starts a fresh one. A loop stuck on a call that never answered froze Matter from 2026-10-17 to
 * 2026-10-19 while the task refused to start a second copy (P-3702).
 */
export const LOOP_STALE_MS = 10 * 60_000;

/** The heartbeat is older than `maxMs`; a missing file is not stale (the loop writes it on its first pass). */
export function heartbeatStale(
  file: string = HEARTBEAT_FILE,
  now: number = Date.now(),
  maxMs: number = LOOP_STALE_MS,
): boolean {
  try {
    return now - statSync(file).mtimeMs > maxMs;
  } catch {
    return false;
  }
}

/** The supervisor wrote its heartbeat within the last minute. */
export function liveAlive(file: string = HEARTBEAT_FILE, now: number = Date.now()): boolean {
  try {
    return now - statSync(file).mtimeMs < ALIVE_MS;
  } catch {
    return false;
  }
}
