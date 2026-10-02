import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { handle, type PipelineContext, type PipelineDeps } from "../../src/server/lib/pipeline";
import { sentryTest } from "../../src/routes/api/hooks/sentry-test";

const TOKEN = "test-token-0123456789";
const URL_ = "https://matterofplace.com/api/hooks/sentry-test";

const post = (authorization?: string) =>
  new Request(URL_, {
    method: "POST",
    headers: authorization === undefined ? {} : { authorization },
  });

describe("sentryTest", () => {
  it("answers 404 when the token is unset", () => {
    expect(sentryTest(post(`Bearer ${TOKEN}`), undefined).status).toBe(404);
    expect(sentryTest(post("Bearer "), "").status).toBe(404);
  });

  it.each([
    { name: "a wrong bearer", authorization: "Bearer test-token-0123456780" },
    { name: "a shorter bearer", authorization: "Bearer test-token" },
    { name: "the token without the Bearer scheme", authorization: TOKEN },
    { name: "no authorization header", authorization: undefined },
  ])("answers 404 for $name", ({ authorization }) => {
    expect(sentryTest(post(authorization), TOKEN).status).toBe(404);
  });

  it("throws the marked error for the right bearer", () => {
    expect(() => sentryTest(post(`Bearer ${TOKEN}`), TOKEN)).toThrow(
      expect.objectContaining({ name: "SentryTestError" }),
    );
  });

  it("answers 500 with the request id and no-store through handle, and reports the error", async () => {
    const waitUntil = vi.fn<PipelineContext["waitUntil"]>();
    const report = vi.fn<PipelineDeps["report"]>(() => Promise.resolve());
    const response = await handle(
      post(`Bearer ${TOKEN}`),
      { env: { MOP_ENV: "local" }, waitUntil },
      {
        render: (request) => Promise.resolve(sentryTest(request, TOKEN)),
        cache: (_request, render) => render(),
        getFlags: () => Promise.resolve({}),
        report,
      },
    );
    const requestId = response.headers.get("x-request-id");
    const body = z
      .object({ error: z.object({ code: z.string(), requestId: z.string() }) })
      .parse(await response.json());
    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body.error).toMatchObject({ code: "server", requestId });
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ name: "SentryTestError" }), {
      requestId,
      route: "/api/hooks/sentry-test",
    });
    expect(waitUntil).toHaveBeenCalledTimes(1);
  });
});
