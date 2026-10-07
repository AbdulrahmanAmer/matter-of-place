import { z } from "zod";
import type { ChannelFailure } from "./oauth-tokens.ts";

// How an X answer that was not 2xx is handled (B10 invariants 3a and 3b, R34): the same four classes as
// `meta-errors.ts`. A rate limit or the usage cap waits for X's own reset time; a refused refresh, or a 401 after a
// refresh, is a dead token that a human reconnects.

// X's problem type for the monthly usage cap, matched by type whatever the status it comes with.
const USAGE_CAPPED = "https://api.twitter.com/2/problems/usage-capped";
// The 15-minute window and the two 24-hour posting limits. A limit is over only once all of them have reset.
const RESET_HEADERS = [
  "x-rate-limit-reset",
  "x-user-limit-24hour-reset",
  "x-app-limit-24hour-reset",
];

const xErrorSchema = z
  .object({
    error: z.string().optional(),
    title: z.string().optional(),
    type: z.string().optional(),
    detail: z.string().optional(),
  })
  .passthrough();

/** The latest reset X names, in epoch seconds, or null when it names none. */
function resetAt(headers: Headers): Date | null {
  const seconds = RESET_HEADERS.map((name) => Number(headers.get(name))).filter(
    (value) => Number.isFinite(value) && value > 0,
  );
  return seconds.length === 0 ? null : new Date(Math.max(...seconds) * 1000);
}

/**
 * The class of an X answer. `refreshed` says the token was refreshed for this call, so a 401 means X no longer
 * accepts the grant; a 401 before a refresh is retried with a new token by the caller.
 */
export function classifyXError(
  status: number,
  body: unknown,
  headers: Headers,
  refreshed: boolean,
): ChannelFailure {
  const problem = xErrorSchema.safeParse(body).data;
  const failure = {
    status,
    reason: null,
    retryAt: null,
    message: problem?.detail ?? problem?.title ?? problem?.error ?? `X answered ${String(status)}.`,
  };
  if (problem?.error === "invalid_grant") {
    return { ...failure, class: "token_dead", reason: "invalid_grant" };
  }
  if (status === 429 || problem?.type === USAGE_CAPPED) {
    return { ...failure, class: "retry_at", retryAt: resetAt(headers) };
  }
  if (status === 401) return { ...failure, class: refreshed ? "token_dead" : "retryable" };
  return { ...failure, class: status >= 500 ? "retryable" : "non_retryable" };
}
