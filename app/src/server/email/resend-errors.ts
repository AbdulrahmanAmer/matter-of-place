import { z } from "zod";
import { logLine } from "../lib/log.ts";

// The one table of Resend's error answers (INT-11, R34), read by the name in the body first and the status second.
// Names and statuses as Resend documents them at https://resend.com/docs/api-reference/errors (read 2026-10-05).
// Imported by `resend-client.ts` and by B11's broadcast channel.

export type ResendOutcome =
  | { kind: "retry_at"; at: Date; reason: string }
  | { kind: "retry" }
  | { kind: "fatal"; code: string }
  | { kind: "already_sent" };

type Classify = (now: Date, headers: Headers) => ResendOutcome;

const MIN_WAIT_S = 2;
const UNKNOWN_429_WAIT_S = 60;
const LOCKED_WAIT_S = 30;

const after = (now: Date, seconds: number): Date => new Date(now.getTime() + seconds * 1000);

/** The next UTC day at `hour`:`minute`. */
const nextUtcDay = (now: Date, hour: number, minute: number): Date =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, hour, minute));

/** The 1st of the next UTC month at 00:01. */
export const nextUtcMonth = (now: Date): Date =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 1));

export const nextUtcMidnight = (now: Date): Date => nextUtcDay(now, 0, 1);

export const nextUtcBulkHour = (now: Date): Date => nextUtcDay(now, 1, 0);

/** Retry-After seconds, never under two. */
function retryAfter(name: string): Classify {
  return (now, headers) => {
    // A missing or unreadable header reads as 0, so the wait is the two seconds.
    const wait = Math.max(Number(headers.get("retry-after")) || 0, MIN_WAIT_S);
    return { kind: "retry_at", at: after(now, wait), reason: name };
  };
}

const fatal =
  (code: string): Classify =>
  () => ({ kind: "fatal", code });

const lockedFor =
  (name: string): Classify =>
  (now) => ({ kind: "retry_at", at: after(now, LOCKED_WAIT_S), reason: name });

export const RESEND_ERRORS = {
  rate_limit_exceeded: retryAfter("rate_limit_exceeded"),
  service_unavailable: retryAfter("service_unavailable"),
  // The free plan's quota resets at midnight UTC.
  daily_quota_exceeded: (now) => {
    logLine("warn", "resend_quota_daily");
    return { kind: "retry_at", at: nextUtcMidnight(now), reason: "daily_quota_exceeded" };
  },
  monthly_quota_exceeded: (now) => ({
    kind: "retry_at",
    at: nextUtcMonth(now),
    reason: "monthly_quota_exceeded",
  }),
  concurrent_idempotent_requests: lockedFor("concurrent_idempotent_requests"),
  resource_locked: lockedFor("resource_locked"),
  // The same key with another body: the first attempt was accepted, so this message is already out.
  invalid_idempotent_request: () => ({ kind: "already_sent" }),
  missing_api_key: fatal("missing_api_key"),
  restricted_api_key: fatal("restricted_api_key"),
  suspended_api_key: fatal("suspended_api_key"),
  invalid_permission: fatal("invalid_permission"),
  validation_error: fatal("validation_error"),
  invalid_idempotency_key: fatal("invalid_idempotency_key"),
  application_error: () => ({ kind: "retry" }),
} satisfies Record<string, Classify>;

const isKnown = (name: string): name is keyof typeof RESEND_ERRORS =>
  Object.hasOwn(RESEND_ERRORS, name);

const errorBody = z.object({ name: z.string() }).passthrough();

/** The `name` of a Resend error body, or null when the body carries none. */
export function resendErrorName(body: unknown): string | null {
  return errorBody.safeParse(body).data?.name ?? null;
}

function byStatus(status: number, now: Date): ResendOutcome {
  if (status === 429) {
    return { kind: "retry_at", at: after(now, UNKNOWN_429_WAIT_S), reason: "status_429" };
  }
  if (status >= 400 && status < 500) return { kind: "fatal", code: `resend_${String(status)}` };
  return { kind: "retry" };
}

export function classifyResendError(
  status: number,
  body: unknown,
  headers: Headers,
  now: Date,
): ResendOutcome {
  const name = resendErrorName(body);
  if (name !== null && isKnown(name)) {
    const classify: Classify = RESEND_ERRORS[name];
    return classify(now, headers);
  }
  return byStatus(status, now);
}

/** A refused send: `code` is the error name, else `status_<n>`; `outcome` is what the caller does next. */
export class ResendError extends Error {
  readonly code: string;
  readonly outcome: ResendOutcome;

  constructor(code: string, outcome: ResendOutcome) {
    super(`resend_${code}`);
    this.name = "ResendError";
    this.code = code;
    this.outcome = outcome;
  }
}
