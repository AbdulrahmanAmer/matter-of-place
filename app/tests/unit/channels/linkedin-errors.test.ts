// B10 step 5a: how a LinkedIn answer that was not 2xx is classed (R34), from the fixtures under tests/fixtures/linkedin.
import { describe, expect, it } from "vitest";
import { classifyLinkedInError } from "../../../src/server/channels/linkedin-errors.ts";
import { answerOf } from "../../fixtures/social-api";

const NOW = new Date("2026-10-04T12:00:00.000Z");

const classed = (status: number, body: unknown, refreshed = false, headers = new Headers()) =>
  classifyLinkedInError(status, body, headers, refreshed, NOW);

describe("classifyLinkedInError", () => {
  it("gives retry_at for a 429, at Retry-After when LinkedIn sends one", () => {
    expect(classed(429, null)).toMatchObject({ class: "retry_at", retryAt: null });
    expect(classed(429, null, false, new Headers({ "retry-after": "120" }))).toMatchObject({
      class: "retry_at",
      retryAt: new Date("2026-10-04T12:02:00.000Z"),
    });
  });

  it("gives token_dead for a 401 after a refresh and for invalid_grant", () => {
    expect(classed(401, { status: 401, message: "Expired token" }, true)).toMatchObject({
      class: "token_dead",
    });
    expect(classed(400, { error: "invalid_grant" })).toMatchObject({
      class: "token_dead",
      reason: "invalid_grant",
    });
  });

  it("gives non_retryable for a 422 and retryable for a 500", () => {
    expect(classed(422, { status: 422, message: "Invalid commentary" })).toMatchObject({
      class: "non_retryable",
      reason: null,
      message: "Invalid commentary",
    });
    expect(classed(500, null).class).toBe("retryable");
  });

  it("gives non_retryable with the reason version_expired for a 426 or a version code", () => {
    const expired = answerOf("linkedin", "version-expired");
    const missing = answerOf("linkedin", "version-missing");
    expect(classed(expired.status, expired.body)).toMatchObject({
      class: "non_retryable",
      reason: "version_expired",
    });
    expect(classed(426, null).reason).toBe("version_expired");
    expect(classed(missing.status, missing.body)).toMatchObject({
      class: "non_retryable",
      reason: "version_expired",
    });
  });
});
