import { fromBase64, hmacSha256, timingSafeEqual } from "../lib/crypto";
import { applyEmailEvent, resendEvent, type ResendEvent } from "../email/events";
import type { Db } from "../lib/db";
import type { env as workerEnv } from "../lib/env";
import { AppError } from "../lib/errors";
import { logLine } from "../lib/log";

// `POST /api/hooks/resend` (R36): the Svix signature over the raw body, a five-minute timestamp window, one receipt
// per `svix-id` so a replay changes nothing, then the effect. A failed effect forgets its receipt, so Resend's retry
// is applied and never taken for a replay.

const PROVIDER = "resend";
const TOLERANCE_SECONDS = 300;
const SECRET_PREFIX = "whsec_";

const refused = () => new AppError("unauthorized", undefined, "The signature does not match.");

const decode = (text: string): Uint8Array | null => {
  try {
    return fromBase64(text);
  } catch {
    return null;
  }
};

/** True when one `v1,<base64>` entry of `svix-signature` is the HMAC of `<id>.<timestamp>.<body>` under the secret. */
export async function verifySvix(
  secret: string,
  headers: { id: string; timestamp: string; signature: string },
  body: string,
): Promise<boolean> {
  const key = decode(
    secret.startsWith(SECRET_PREFIX) ? secret.slice(SECRET_PREFIX.length) : secret,
  );
  if (key === null) return false;
  const expected = await hmacSha256(key, `${headers.id}.${headers.timestamp}.${body}`);
  return headers.signature.split(" ").some((entry) => {
    const [version, value] = entry.split(",");
    if (version !== "v1" || value === undefined) return false;
    const given = decode(value);
    return given !== null && timingSafeEqual(given, expected);
  });
}

async function applyEffect(db: Db, event: ResendEvent, id: string, ownEnv: string): Promise<void> {
  if (event.type === "email.complained") {
    const recipients = event.data.to ?? [];
    for (const email of typeof recipients === "string" ? [recipients] : recipients) {
      const { error } = await db.rpc("unsubscribe_email", { p_email: email });
      if (error !== null) {
        throw new AppError("server", undefined, "The event could not be applied.");
      }
    }
  }
  await applyEmailEvent(db, { ...event, id }, ownEnv);
}

export async function handleResend(
  request: Request,
  db: Db,
  env: typeof workerEnv,
): Promise<Response> {
  const secret = env.RESEND_WEBHOOK_SECRET;
  if (secret === undefined) {
    throw new AppError("unavailable", undefined, "This hook is not configured.");
  }
  const body = await request.text();
  const id = request.headers.get("svix-id");
  const timestamp = request.headers.get("svix-timestamp");
  const signature = request.headers.get("svix-signature");
  if (id === null || timestamp === null || signature === null) throw refused();
  const sentAt = Number(timestamp);
  if (!Number.isInteger(sentAt) || Math.abs(Date.now() / 1000 - sentAt) > TOLERANCE_SECONDS) {
    throw refused();
  }
  if (!(await verifySvix(secret, { id, timestamp, signature }, body))) throw refused();

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new AppError("bad_request", undefined, "The event could not be read.");
  }
  const event = resendEvent.safeParse(parsed);
  if (!event.success) throw new AppError("bad_request", undefined, "The event could not be read.");

  const receipt = await db.rpc("record_webhook_receipt", { p_provider: PROVIDER, p_id: id });
  if (receipt.error !== null) {
    throw new AppError("server", undefined, "The event could not be recorded.");
  }
  const ok = () => Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  if (!receipt.data) return ok();
  try {
    await applyEffect(db, event.data, id, env.MOP_ENV);
  } catch (error) {
    const forgot = await db.rpc("forget_webhook_receipt", { p_provider: PROVIDER, p_id: id });
    if (forgot.error !== null) logLine("error", "webhook_forget_failed", { provider: PROVIDER });
    throw error;
  }
  return ok();
}
