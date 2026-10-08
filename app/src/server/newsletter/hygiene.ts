import { z } from "zod";
import { readSettings } from "../email/context.ts";
import { enqueueRepermissionEmail, lapseSubscribers } from "../email/repermission.ts";
import { NonRetryableError } from "../jobs/types.ts";
import type { Db } from "../lib/db.ts";
import { MARKET_AUDIENCE, syncAudience, type AudienceKey, type SyncResult } from "./audience.ts";

// The daily list hygiene (B11 invariant 10, GG-05): ask the idle subscribers to confirm again, archive the ones who
// never answered, then make each Resend audience hold exactly its members. B5 owns the first two helpers and the SQL
// behind them; this file only orders the calls.

/** At most this many re-permission emails a day, so a long idle list is asked over weeks and never in one burst. */
const DAILY_ASKS = 20;

const AUDIENCE_KEYS: readonly string[] = ["place-notes", ...Object.values(MARKET_AUDIENCE)];

const resendSettings = z.object({ audiences: z.record(z.string(), z.string()) }).passthrough();

// A type, not an interface, so the result is Json for `jobs.result`.
export type HygieneResult = {
  candidates: number;
  asked: number;
  lapsed: number;
  audiences: Record<string, SyncResult>;
};

const isAudienceKey = (key: string): key is AudienceKey => AUDIENCE_KEYS.includes(key);

/** The audiences Resend is known to hold (`settings.resend.audiences`); none until the first broadcast made them. */
async function storedAudienceKeys(db: Db): Promise<AudienceKey[]> {
  const stored = (await readSettings(db, ["resend"])).get("resend");
  if (stored === undefined) return [];
  const parsed = resendSettings.safeParse(stored);
  if (!parsed.success) throw new NonRetryableError("resend_settings_invalid");
  return Object.keys(parsed.data.audiences).filter(isAudienceKey);
}

async function candidateIds(db: Db): Promise<string[]> {
  const { data, error } = await db.rpc("repermission_candidates", { p_limit: DAILY_ASKS });
  if (error !== null) throw new Error("newsletter_read_failed:repermission_candidates");
  return data.map(({ id }) => id);
}

/**
 * Runs the three steps in order and answers their counts. A `RateLimited` from the audience step ends the run there
 * for the caller's `retry_at`; the first two steps are safe to repeat, as a subscriber is asked once and lapsed once.
 * `sealKey` is the runner's `CONFIRM_TOKEN_SECRET`, with which each new confirm token is sealed.
 */
export async function runHygiene(db: Db, sealKey: string): Promise<HygieneResult> {
  const ids = await candidateIds(db);
  let asked = 0;
  for (const id of ids) {
    if ((await enqueueRepermissionEmail(db, id, sealKey)) === "asked") asked += 1;
  }
  const lapsed = await lapseSubscribers(db);
  const audiences: Record<string, SyncResult> = {};
  for (const key of await storedAudienceKeys(db)) audiences[key] = await syncAudience(db, key);
  return { candidates: ids.length, asked, lapsed, audiences };
}
