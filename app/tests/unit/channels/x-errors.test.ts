// B10 step 5a: how an X answer that was not 2xx is classed (R34), from the fixtures under tests/fixtures/x.
import { describe, expect, it } from "vitest";
import { classifyXError } from "../../../src/server/channels/x-errors.ts";
import { answerOf } from "../../fixtures/social-api";

const classed = (name: string, refreshed = false) => {
  const answer = answerOf("x", name);
  return classifyXError(answer.status, answer.body, new Headers(answer.headers), refreshed);
};

describe("classifyXError", () => {
  it("gives retry_at at the latest reset X names for a 429", () => {
    expect(classed("rate-limited")).toMatchObject({
      class: "retry_at",
      status: 429,
      retryAt: new Date("2026-10-04T18:00:00.000Z"),
    });
  });

  it("gives retry_at for the monthly usage cap, whatever its status", () => {
    const answer = answerOf("x", "usage-capped");
    expect(classed("usage-capped")).toMatchObject({
      class: "retry_at",
      retryAt: null,
      message: "Usage cap exceeded: Monthly product cap",
    });
    expect(classifyXError(403, answer.body, new Headers(), false).class).toBe("retry_at");
  });

  it("gives token_dead for a 401 after a refresh and for invalid_grant, and retryable for a 401 before one", () => {
    expect(classifyXError(401, { title: "Unauthorized" }, new Headers(), true)).toMatchObject({
      class: "token_dead",
    });
    expect(classed("invalid-grant")).toMatchObject({
      class: "token_dead",
      reason: "invalid_grant",
    });
    expect(classifyXError(401, { title: "Unauthorized" }, new Headers(), false).class).toBe(
      "retryable",
    );
  });

  it("gives retryable for a 503 and non_retryable for a 400", () => {
    expect(classifyXError(503, null, new Headers(), false).class).toBe("retryable");
    expect(
      classifyXError(
        400,
        { title: "Invalid Request", detail: "text too long" },
        new Headers(),
        false,
      ),
    ).toMatchObject({ class: "non_retryable", message: "text too long" });
  });
});
