import { z } from "zod";
import { NonRetryableError } from "../jobs/types.ts";
import { liveSideEffects, readVar } from "../lib/runtime-env.ts";
import type { EmailAttachment } from "./attachments.ts";
import { classifyResendError, ResendError, resendErrorName } from "./resend-errors.ts";

// The Resend adapter (R32): the only file that calls `api.resend.com` for one email. Every variable is read on each
// call through `readVar`, because the job runner has no `env.ts` (G39). Resend refuses a request without a
// `User-Agent` (https://resend.com/docs/api-reference/introduction, read 2026-10-05), and keeps an `Idempotency-Key`
// for 24 hours: the same key with the same body answers the first id without sending again.

const ENDPOINT = "https://api.resend.com/emails";
const USER_AGENT = "matter-of-place/1";

/** The send classes of `email_messages.kind`: a template's class, or `test` for a test send. */
export type SendKind = "transactional" | "alert" | "bulk" | "test";

export interface TransactionalEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  kind: SendKind;
  idempotencyKey: string;
  replyTo?: string | undefined;
  attachments?: readonly EmailAttachment[] | undefined;
  now: Date;
  signal: AbortSignal;
}

export type SendAnswer = { id: string; dryRun: boolean };

const accepted = z.object({ id: z.string().min(1) }).passthrough();

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Sends one email, or, when this environment may not send (`EMAIL_DRY_RUN=1`, or neither `MOP_ENV=production` nor
 * `EMAIL_LIVE=1`, invariant 16), makes no call and answers a `dry_` id. A refusal throws `ResendError` with the
 * outcome of `classifyResendError`; a network failure throws as it came, for the runner's backoff.
 */
export async function sendTransactional(email: TransactionalEmail): Promise<SendAnswer> {
  if (!liveSideEffects("email")) return { id: `dry_${crypto.randomUUID()}`, dryRun: true };
  const key = readVar("RESEND_API_KEY");
  const from = readVar(email.kind === "bulk" ? "RESEND_FROM_BULK" : "RESEND_FROM");
  if (!key || !from) throw new NonRetryableError("resend_not_configured");
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      "idempotency-key": email.idempotencyKey,
      "user-agent": USER_AGENT,
    },
    body: JSON.stringify({
      from,
      to: [email.to],
      subject: email.subject,
      html: email.html,
      text: email.text,
      ...(email.replyTo === undefined ? {} : { reply_to: email.replyTo }),
      ...(email.attachments === undefined ? {} : { attachments: email.attachments }),
      tags: [{ name: "env", value: readVar("MOP_ENV") ?? "unset" }],
    }),
    signal: email.signal,
  });
  const body = parseJson(await response.text());
  if (!response.ok) {
    const outcome = classifyResendError(response.status, body, response.headers, email.now);
    throw new ResendError(resendErrorName(body) ?? `status_${String(response.status)}`, outcome);
  }
  const answer = accepted.safeParse(body);
  if (!answer.success) throw new Error("resend_answer_unreadable");
  return { id: answer.data.id, dryRun: false };
}
