import type { Db } from "./db";
import { AppError } from "./errors.ts";

export type LimitResult = { ok: true } | { ok: false; retryAfter: number };

/** One database limit; `keyHash` is `hashKey(RATE_LIMIT_SALT, <ip or lower(email)>)`, never the raw value. */
export interface DbCheck {
  bucket: string;
  keyHash: string;
  limit: number;
  windowSeconds: number;
}

const UNAVAILABLE = "The service is busy. Please try again in a moment.";

/**
 * Every check in one `rate_limit_check` call: a hit is recorded only when all of them pass. Two checks on one
 * bucket with different windows each count the hits inside their own window.
 */
export async function checkDb(db: Db, checks: readonly DbCheck[]): Promise<LimitResult> {
  const { data, error } = await db.rpc("rate_limit_check", {
    p_checks: checks.map((check) => ({
      bucket: check.bucket,
      key_hash: check.keyHash,
      limit: check.limit,
      window_seconds: check.windowSeconds,
    })),
  });
  const row = data?.[0];
  if (error !== null || row === undefined)
    throw new AppError("unavailable", undefined, UNAVAILABLE);
  return row.allowed ? { ok: true } : { ok: false, retryAfter: row.retry_after };
}

interface MemoryWindow {
  start: number;
  windowMs: number;
  count: number;
}

// Per isolate; windows that have run out are dropped once the map holds this many keys.
const MEMORY_SWEEP_SIZE = 10_000;
const windows = new Map<string, MemoryWindow>();

const expired = (window: MemoryWindow, now: number): boolean =>
  now - window.start >= window.windowMs;

/** A fixed-window counter in the isolate's memory, the cheap first line before any database call. */
export function checkMemory(
  bucket: string,
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): LimitResult {
  const id = `${bucket}:${key}`;
  const current = windows.get(id);
  if (current === undefined || expired(current, now)) {
    if (windows.size >= MEMORY_SWEEP_SIZE) {
      for (const [other, window] of windows) if (expired(window, now)) windows.delete(other);
    }
    windows.set(id, { start: now, windowMs, count: 1 });
    return { ok: true };
  }
  if (current.count >= limit) {
    return { ok: false, retryAfter: Math.ceil((current.start + current.windowMs - now) / 1000) };
  }
  current.count += 1;
  return { ok: true };
}
