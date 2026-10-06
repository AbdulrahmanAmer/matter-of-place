import { afterEach, describe, expect, it, vi } from "vitest";
import {
  classifyResendError,
  RESEND_ERRORS,
  type ResendOutcome,
} from "../../../src/server/email/resend-errors";

// INT-11: one row per error name Resend documents for sending, and the status fallback for any other answer.

const NOW = new Date("2026-10-05T14:30:00.000Z");

/** An outcome with its time as an ISO string, so a table row can state it. */
function plain(outcome: ResendOutcome) {
  return outcome.kind === "retry_at" ? { ...outcome, at: outcome.at.toISOString() } : outcome;
}

const retryAt = (at: string, reason: string) => ({ kind: "retry_at", at, reason });
const fatal = (code: string) => ({ kind: "fatal", code });

const byName = [
  {
    name: "rate_limit_exceeded",
    status: 429,
    retryAfter: "7",
    outcome: retryAt("2026-10-05T14:30:07.000Z", "rate_limit_exceeded"),
  },
  {
    name: "service_unavailable",
    status: 503,
    retryAfter: "1",
    outcome: retryAt("2026-10-05T14:30:02.000Z", "service_unavailable"),
  },
  {
    name: "daily_quota_exceeded",
    status: 429,
    retryAfter: null,
    outcome: retryAt("2026-10-06T00:01:00.000Z", "daily_quota_exceeded"),
  },
  {
    name: "monthly_quota_exceeded",
    status: 429,
    retryAfter: null,
    outcome: retryAt("2026-11-01T00:01:00.000Z", "monthly_quota_exceeded"),
  },
  {
    name: "concurrent_idempotent_requests",
    status: 409,
    retryAfter: null,
    outcome: retryAt("2026-10-05T14:30:30.000Z", "concurrent_idempotent_requests"),
  },
  {
    name: "resource_locked",
    status: 409,
    retryAfter: null,
    outcome: retryAt("2026-10-05T14:30:30.000Z", "resource_locked"),
  },
  {
    name: "invalid_idempotent_request",
    status: 409,
    retryAfter: null,
    outcome: { kind: "already_sent" },
  },
  { name: "missing_api_key", status: 401, retryAfter: null, outcome: fatal("missing_api_key") },
  {
    name: "restricted_api_key",
    status: 403,
    retryAfter: null,
    outcome: fatal("restricted_api_key"),
  },
  {
    name: "suspended_api_key",
    status: 403,
    retryAfter: null,
    outcome: fatal("suspended_api_key"),
  },
  {
    name: "invalid_permission",
    status: 403,
    retryAfter: null,
    outcome: fatal("invalid_permission"),
  },
  { name: "validation_error", status: 403, retryAfter: null, outcome: fatal("validation_error") },
  {
    name: "invalid_idempotency_key",
    status: 400,
    retryAfter: null,
    outcome: fatal("invalid_idempotency_key"),
  },
  { name: "application_error", status: 500, retryAfter: null, outcome: { kind: "retry" } },
];

const byStatus = [
  { status: 429, outcome: retryAt("2026-10-05T14:31:00.000Z", "status_429") },
  { status: 422, outcome: fatal("resend_422") },
  { status: 404, outcome: fatal("resend_404") },
  { status: 500, outcome: { kind: "retry" } },
  { status: 502, outcome: { kind: "retry" } },
];

afterEach(() => {
  vi.restoreAllMocks();
});

describe("classifyResendError", () => {
  it("has one table row for every name of RESEND_ERRORS", () => {
    expect(byName.map((row) => row.name).sort()).toEqual(Object.keys(RESEND_ERRORS).sort());
  });

  it.each(byName)("$name gives its outcome and time", ({ name, status, retryAfter, outcome }) => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const headers = new Headers(retryAfter === null ? {} : { "retry-after": retryAfter });
    const body = { statusCode: status, name, message: "from Resend" };
    expect(plain(classifyResendError(status, body, headers, NOW))).toEqual(outcome);
  });

  it.each(byStatus)(
    "an unknown name at $status falls back to its status",
    ({ status, outcome }) => {
      const body = { statusCode: status, name: "not_a_documented_name" };
      expect(plain(classifyResendError(status, body, new Headers(), NOW))).toEqual(outcome);
    },
  );

  it("reads the status when the body is not a Resend error", () => {
    expect(plain(classifyResendError(503, null, new Headers(), NOW))).toEqual({ kind: "retry" });
  });

  it("waits two seconds when a rate limit names no Retry-After", () => {
    const body = { name: "rate_limit_exceeded" };
    expect(plain(classifyResendError(429, body, new Headers(), NOW))).toEqual(
      retryAt("2026-10-05T14:30:02.000Z", "rate_limit_exceeded"),
    );
  });

  it("logs resend_quota_daily for the daily quota", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    classifyResendError(429, { name: "daily_quota_exceeded" }, new Headers(), NOW);
    expect(warn.mock.calls.map(([line]) => String(line))).toEqual([
      JSON.stringify({ level: "warn", event: "resend_quota_daily" }),
    ]);
  });
});
