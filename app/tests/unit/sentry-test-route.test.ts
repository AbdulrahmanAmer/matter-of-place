import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { handle, type PipelineContext, type PipelineDeps } from "../../src/server/lib/pipeline";
import { handleSentryTest } from "../../src/server/hooks/sentry-test";

const TOKEN = "test-token-0123456789";
const URL_ = "https://matterofplace.com/api/hooks/sentry-test";
const ID = "req-12345678";

const post = (authorization?: string) =>
  new Request(URL_, {
    method: "POST",
    headers: authorization === undefined ? {} : { authorization },
  });

const ErrorBody = z.object({
  error: z.object({ code: z.string(), message: z.string(), requestId: z.string() }),
});

async function answerOf(response: Response) {
  return {
    status: response.status,
    type: response.headers.get("content-type"),
    cacheControl: response.headers.get("cache-control"),
    error: ErrorBody.parse(await response.json()).error,
  };
}

const notFound = (requestId: string | null) => ({
  status: 404,
  type: "application/json",
  cacheControl: "no-store",
  error: { code: "not_found", message: "There is nothing at this address.", requestId },
});

function throughHandle(request: Request, token: string) {
  const waitUntil = vi.fn<PipelineContext["waitUntil"]>();
  const report = vi.fn<PipelineDeps["report"]>(() => Promise.resolve());
  const response = handle(
    request,
    { env: { MOP_ENV: "local" }, waitUntil },
    {
      render: (rendered, requestId) =>
        Promise.resolve(handleSentryTest(rendered, requestId, token)),
      redirect: () => Promise.resolve(null),
      cache: (_request, render) => render(),
      getFlags: () => Promise.resolve({}),
      report,
      isApiRoute: () => true,
    },
  );
  return { response, report, waitUntil };
}

describe("handleSentryTest", () => {
  it("answers the R09 404 with the request id when the token is unset", async () => {
    expect(await answerOf(handleSentryTest(post(`Bearer ${TOKEN}`), ID, undefined))).toEqual(
      notFound(ID),
    );
    expect(await answerOf(handleSentryTest(post("Bearer "), ID, ""))).toEqual(notFound(ID));
  });

  it.each([
    { name: "a wrong bearer", authorization: "Bearer test-token-0123456780" },
    { name: "a shorter bearer", authorization: "Bearer test-token" },
    { name: "the token without the Bearer scheme", authorization: TOKEN },
    { name: "no authorization header", authorization: undefined },
  ])("answers the R09 404 for $name", async ({ authorization }) => {
    expect(await answerOf(handleSentryTest(post(authorization), ID, TOKEN))).toEqual(notFound(ID));
  });

  it("throws the marked error for the right bearer", () => {
    expect(() => handleSentryTest(post(`Bearer ${TOKEN}`), ID, TOKEN)).toThrow(
      expect.objectContaining({ name: "SentryTestError" }),
    );
  });

  it.each([
    { name: "no token", authorization: `Bearer ${TOKEN}`, token: "" },
    { name: "a wrong bearer", authorization: "Bearer test-token-0123456780", token: TOKEN },
    { name: "no scheme", authorization: TOKEN, token: TOKEN },
  ])("through handle, refuses $name with the id of x-request-id", async (refusal) => {
    const response = await throughHandle(post(refusal.authorization), refusal.token).response;
    expect(await answerOf(response)).toEqual(notFound(response.headers.get("x-request-id")));
  });

  it("answers 500 with the request id and no-store through handle, and reports the error", async () => {
    const { response: pending, report, waitUntil } = throughHandle(post(`Bearer ${TOKEN}`), TOKEN);
    const response = await pending;
    const requestId = response.headers.get("x-request-id");
    const body = ErrorBody.parse(await response.json());
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
