import { z } from "zod";
import { appRoles } from "../../domain/contracts.ts";
import type { AppRole } from "./authz.ts";
import { randomToken, sha256Hex } from "./crypto.ts";
import type { Db } from "./db.ts";
import { AppError } from "./errors.ts";
import { checkDb, checkMemory, memoryExhausted } from "./ratelimit.ts";

// Agent keys (S38, architecture 6). Only the sha256 of a key is stored; the key itself is shown once. Every
// request looks the key up again (never memoised), so a revoked key or a disabled agent fails at once.

const PREFIX = "mopk_";
// Failed lookups from one address (API-04): counted in memory and refused before the next lookup.
const FAIL_BUCKET = "agent_key_fail:ip";
const FAIL_LIMIT = 20;
const FAIL_WINDOW_MS = 60_000;
const PER_MINUTE = 60;
const DAY_SECONDS = 86_400;
const TOUCH_AFTER_MS = 60_000;
// `settings.agent_daily_limits` is read at most this often per isolate (screen 23 edits it).
const LIMITS_TTL_MS = 60_000;

export interface AgentKey {
  keyId: string;
  userId: string;
  roles: AppRole[];
  scopes: string[];
}

/** The sha256 hex stored in `agent_keys.key_hash` (CS-04: no `hashKey` here, which is B3's salted hash). */
export function hashAgentKey(key: string): Promise<string> {
  return sha256Hex(key);
}

/** `mopk_<environment>_<32 random bytes base64url>`: the prefix makes a leaked key recognisable. */
export function generateKey(environment: string): string {
  return `${PREFIX}${environment}_${randomToken(32)}`;
}

const keyRowSchema = z.object({
  key_id: z.string(),
  user_id: z.string(),
  scopes: z.array(z.string()),
  revoked_at: z.string().nullable(),
  last_used_at: z.string().nullable(),
  roles: z.array(z.enum(appRoles)),
});

const limitsSchema = z.object({ requests_per_day: z.number().int().positive() });
let dailyLimit: { value: number; readAt: number } | undefined;

async function requestsPerDay(db: Db, now: number): Promise<number> {
  if (dailyLimit !== undefined && now - dailyLimit.readAt < LIMITS_TTL_MS) return dailyLimit.value;
  const { data, error } = await db.from("settings").select("value").eq("key", "agent_daily_limits");
  const parsed = limitsSchema.safeParse(data?.[0]?.value);
  if (error !== null || !parsed.success) {
    throw new AppError(
      "unavailable",
      undefined,
      "The service is busy. Please try again in a moment.",
    );
  }
  dailyLimit = { value: parsed.data.requests_per_day, readAt: now };
  return dailyLimit.value;
}

const refused = () => new AppError("unauthorized", undefined, "This key is not valid.");

/** 429 `rate_limited`; `defineAdminRoute` answers it with `Retry-After`. */
export class KeyRateLimited extends AppError {
  readonly retryAfter: number;

  constructor(retryAfter: number) {
    super("rate_limited", undefined, "Too many requests. Please slow down.");
    this.name = "KeyRateLimited";
    this.retryAfter = retryAfter;
  }
}

const limited = (retryAfter: number) => new KeyRateLimited(retryAfter);

/**
 * The agent behind `key`, after the request limits of invariant 3: a refused address is answered from
 * memory, a valid key passes one `rate_limit_check` (60 a minute and `requests_per_day`), and
 * `last_used_at` is written at most once a minute.
 */
export async function verifyKey(
  db: Db,
  key: string,
  ip: string,
  now = Date.now(),
): Promise<AgentKey> {
  const blocked = memoryExhausted(FAIL_BUCKET, ip, FAIL_LIMIT, now);
  if (!blocked.ok) throw limited(blocked.retryAfter);
  const { data, error } = key.startsWith(PREFIX)
    ? await db.rpc("agent_key_by_hash", { p_hash: await hashAgentKey(key) })
    : { data: [], error: null };
  if (error !== null) {
    throw new AppError(
      "unavailable",
      undefined,
      "The service is busy. Please try again in a moment.",
    );
  }
  // The generated type calls every returned column non-null; a fresh or live key has nulls here.
  const row = data.length === 0 ? undefined : keyRowSchema.parse(data[0]);
  if (row === undefined || row.revoked_at !== null || row.roles.length === 0) {
    checkMemory(FAIL_BUCKET, ip, FAIL_LIMIT, FAIL_WINDOW_MS, now);
    throw refused();
  }
  const bucket = `agent:${row.key_id}`;
  const verdict = await checkDb(db, [
    { bucket, keyHash: row.key_id, limit: PER_MINUTE, windowSeconds: 60 },
    {
      bucket,
      keyHash: row.key_id,
      limit: await requestsPerDay(db, now),
      windowSeconds: DAY_SECONDS,
    },
  ]);
  if (!verdict.ok) throw limited(verdict.retryAfter);
  const lastUsed =
    row.last_used_at === null ? Number.NEGATIVE_INFINITY : Date.parse(row.last_used_at);
  if (now - lastUsed > TOUCH_AFTER_MS) {
    const touched = await db.rpc("touch_agent_key", { p_key_id: row.key_id });
    if (touched.error !== null) {
      throw new AppError(
        "unavailable",
        undefined,
        "The service is busy. Please try again in a moment.",
      );
    }
  }
  return { keyId: row.key_id, userId: row.user_id, roles: row.roles, scopes: row.scopes };
}
