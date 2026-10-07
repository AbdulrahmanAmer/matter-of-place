import { z } from "zod";
import type { ChannelFailure } from "./oauth-tokens.ts";

// How a LinkedIn answer that was not 2xx is handled (B10 invariants 3a and 3b, R34): the same four classes as
// `meta-errors.ts`. A pinned `LinkedIn-Version` that LinkedIn no longer serves is `non_retryable` with the reason
// `version_expired`: no retry helps until a human stores a newer `api_version`.

const VERSION_CODES = new Set(["VERSION_MISSING", "NONEXISTENT_VERSION"]);

const linkedInErrorSchema = z
  .object({
    error: z.string().optional(),
    error_description: z.string().optional(),
    code: z.string().optional(),
    message: z.string().optional(),
  })
  .passthrough();

/** `Retry-After` in seconds from `now`, or null when LinkedIn sent none. */
function retryAfter(headers: Headers, now: Date): Date | null {
  const seconds = Number(headers.get("retry-after"));
  return headers.has("retry-after") && Number.isFinite(seconds) && seconds >= 0
    ? new Date(now.getTime() + seconds * 1000)
    : null;
}

/**
 * The class of a LinkedIn answer. `refreshed` says the token was refreshed for this call, so a 401 means LinkedIn no
 * longer accepts the grant; a 401 before a refresh is retried with a new token by the caller.
 */
export function classifyLinkedInError(
  status: number,
  body: unknown,
  headers: Headers,
  refreshed: boolean,
  now: Date,
): ChannelFailure {
  const problem = linkedInErrorSchema.safeParse(body).data;
  const failure = {
    status,
    reason: null,
    retryAt: null,
    message:
      problem?.message ??
      problem?.error_description ??
      problem?.error ??
      `LinkedIn answered ${String(status)}.`,
  };
  if (problem?.error === "invalid_grant") {
    return { ...failure, class: "token_dead", reason: "invalid_grant" };
  }
  if (status === 426 || VERSION_CODES.has(problem?.code ?? "")) {
    return { ...failure, class: "non_retryable", reason: "version_expired" };
  }
  if (status === 429) return { ...failure, class: "retry_at", retryAt: retryAfter(headers, now) };
  if (status === 401) return { ...failure, class: refreshed ? "token_dead" : "retryable" };
  return { ...failure, class: status >= 500 ? "retryable" : "non_retryable" };
}
