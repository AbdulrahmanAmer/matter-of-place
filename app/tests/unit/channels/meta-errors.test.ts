import { describe, expect, it } from "vitest";
import { classifyGraphError } from "../../../src/server/channels/meta-errors.ts";
import mediaNotReady from "../../fixtures/graph/error-media-not-ready.json";
import publishLimit from "../../fixtures/graph/error-publish-limit.json";

// Graph errors to the four classes of invariants 3a and 3b. The two fixtures are Meta's documented answers.

const graphError = (code: number, extra: Record<string, unknown> = {}) => ({
  error: { message: "Graph said no", type: "OAuthException", code, ...extra },
});

describe("classifyGraphError", () => {
  it("treats code 190 as a dead token", () => {
    expect(classifyGraphError(400, graphError(190, { error_subcode: 463 }))).toMatchObject({
      class: "token_dead",
      code: 190,
    });
  });

  it("waits for the rate limits 4, 17, 32 and 613 and the daily publishing limit", () => {
    for (const code of [4, 17, 32, 613]) {
      expect(classifyGraphError(400, graphError(code)).class).toBe("retry_at");
    }
    expect(classifyGraphError(publishLimit.status, publishLimit.response)).toMatchObject({
      class: "retry_at",
      code: 9,
      subcode: 2207042,
    });
  });

  it("retries a container that is not finished, a transient error and a 5xx", () => {
    expect(classifyGraphError(mediaNotReady.status, mediaNotReady.response).class).toBe(
      "retryable",
    );
    expect(classifyGraphError(400, graphError(100, { is_transient: true })).class).toBe(
      "retryable",
    );
    expect(classifyGraphError(503, "<html>busy</html>").class).toBe("retryable");
  });

  it("fails any other error at once, a subcode row matching only its subcode", () => {
    expect(classifyGraphError(400, graphError(100)).class).toBe("non_retryable");
    expect(classifyGraphError(400, graphError(9, { error_subcode: 1 })).class).toBe(
      "non_retryable",
    );
    expect(classifyGraphError(404, null)).toMatchObject({ class: "non_retryable", code: null });
  });

  it("waits on a 429 whose body is not a Graph error", () => {
    expect(classifyGraphError(429, "").class).toBe("retry_at");
  });
});
