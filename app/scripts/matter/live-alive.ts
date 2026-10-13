// W5: whether Matter's live supervisor is up, read by the one-shot runner (which then leaves the operator's lines to
// it) and written by the supervisor. Its own file so the runner never imports the supervisor.
import { statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const HEARTBEAT_FILE = join(homedir(), ".mop-workforce", "matter", "live.heartbeat");
const ALIVE_MS = 60_000;

/** The supervisor wrote its heartbeat within the last minute. */
export function liveAlive(file: string = HEARTBEAT_FILE, now: number = Date.now()): boolean {
  try {
    return now - statSync(file).mtimeMs < ALIVE_MS;
  } catch {
    return false;
  }
}
