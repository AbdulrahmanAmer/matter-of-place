// W5: whether Matter's live supervisor is up, read by the one-shot runner (which then leaves the operator's lines to
// it) and written by the supervisor. Its own file so the runner never imports the supervisor.
import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const HEARTBEAT_FILE = join(homedir(), ".mop-workforce", "matter", "live.heartbeat");
const LOCK_FILE = join(homedir(), ".mop-workforce", "matter", "live.lock");
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

/**
 * How long the heartbeat may be silent before the minute runner ends the supervisor from outside: longer than the
 * supervisor's own watchdog, so the outside one acts only when the process cannot run its own timer (P-3703).
 */
export const OUTSIDE_STALE_MS = 15 * 60_000;

/** The process id in the supervisor's lock file when its heartbeat is older than OUTSIDE_STALE_MS, else null. */
export function stalledSupervisorPid(
  lock: string = LOCK_FILE,
  heartbeat: string = HEARTBEAT_FILE,
  now: number = Date.now(),
): number | null {
  if (!heartbeatStale(heartbeat, now, OUTSIDE_STALE_MS)) return null;
  try {
    const pid = Number(readFileSync(lock, "utf8").trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/** Whether a process's command line is Matter's supervisor, so a reused process id is never ended by mistake. */
export function isSupervisorCommand(commandLine: string): boolean {
  return /matter[\\/]live\.ts/.test(commandLine);
}

/** The supervisor wrote its heartbeat within the last minute. */
export function liveAlive(file: string = HEARTBEAT_FILE, now: number = Date.now()): boolean {
  try {
    return now - statSync(file).mtimeMs < ALIVE_MS;
  } catch {
    return false;
  }
}
