import { randomToken, sha256Hex } from "../lib/crypto.ts";
import type { Db } from "../lib/db.ts";
import { AppError } from "../lib/errors.ts";
import { enqueueJob } from "../lib/jobs.ts";
import { sealToken } from "../subscribers/confirm-email.ts";
import { isSuppressed } from "./suppression.ts";
import { resolveRecipient } from "./variables.ts";

// List hygiene (GG-05, invariant 12): B11's hygiene job asks an idle subscriber once and lapses the ones who never
// answer. Both helpers are its; nothing here runs on a schedule of its own.

/** What one ask did: `asked` enqueued the email, the others enqueued nothing. */
type RepermissionOutcome = "asked" | "suppressed" | "not_consenting";

/**
 * Asks one subscriber to confirm again: a fresh token whose hash `issue_repermission` stores, and one `send_email` job
 * that carries the token sealed with `sealKey` (the runner's `CONFIRM_TOKEN_SECRET`), never in clear.
 */
export async function enqueueRepermissionEmail(
  db: Db,
  subscriberId: string,
  sealKey: string,
): Promise<RepermissionOutcome> {
  const data = { subscriber_id: subscriberId };
  const { to } = await resolveRecipient(db, "repermission", { to: "subscriber" }, data);
  const [email] = to;
  if (email !== undefined && (await isSuppressed(db, email))) return "suppressed";
  const token = randomToken();
  const hash = await sha256Hex(token);
  // Sealed before the ask is stored: a key that cannot seal must not mark a subscriber as asked who was never mailed.
  const sealed = await sealToken(token, sealKey);
  const issued = await db.rpc("issue_repermission", {
    p_subscriber_id: subscriberId,
    p_token_hash: hash,
  });
  if (issued.error !== null) {
    throw new AppError(
      "unavailable",
      undefined,
      "The database did not answer (issue_repermission).",
    );
  }
  if (!issued.data) return "not_consenting";
  await enqueueJob(db, {
    type: "send_email",
    idempotencyKey: `send_email:${subscriberId}:rp:${hash.slice(0, 12)}`,
    params: { template: "repermission", to: "subscriber" },
    data: { ...data, sealed_token: sealed },
  });
  return "asked";
}

/** Archives every subscriber asked more than the grace ago with no answer since; the count `lapse_subscribers` gave. */
export async function lapseSubscribers(db: Db): Promise<number> {
  const { data, error } = await db.rpc("lapse_subscribers", {});
  if (error !== null) {
    throw new AppError(
      "unavailable",
      undefined,
      "The database did not answer (lapse_subscribers).",
    );
  }
  return data;
}
