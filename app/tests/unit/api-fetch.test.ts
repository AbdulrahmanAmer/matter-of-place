// src/lib/api-fetch.functions.ts (B3 invariant 7, step 12): during a server render the API is called in-process.
// Without the Start compiler `createIsomorphicFn` keeps the server branch, which is the one under test.
import { beforeEach, describe, expect, it, vi } from "vitest";

const page = vi.hoisted(() => ({ request: new Request("https://pr-7.example.test/properties") }));
const start = vi.hoisted((): { context: unknown } => ({
  context: { requestId: "page-request-id" },
}));
const handlePublic = vi.hoisted(() =>
  vi.fn<(request: Request, requestId: string) => Promise<Response>>(),
);

vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getGlobalStartContext: () => start.context,
}));
vi.mock("@tanstack/react-start/server", () => ({ getRequest: () => page.request }));
vi.mock("../../src/server/public/pipeline", () => ({ handlePublic }));

import { apiFetch } from "../../src/lib/api-fetch.functions";

/** The in-process request the first call handed to the pipeline. */
function sent(): Request {
  const request = handlePublic.mock.calls[0]?.[0];
  if (request === undefined) throw new Error("the pipeline was not called");
  return request;
}

describe("apiFetch on the server", () => {
  beforeEach(() => {
    page.request = new Request("https://pr-7.example.test/properties");
    start.context = { requestId: "page-request-id" };
    handlePublic.mockReset();
    handlePublic.mockResolvedValue(new Response("[]", { status: 200 }));
  });

  it("calls the public pipeline in-process with the page's request id", async () => {
    await apiFetch("/api/public/properties", { method: "GET" });
    expect([sent().url, handlePublic.mock.calls[0]?.[1]]).toEqual([
      "https://pr-7.example.test/api/public/properties",
      "page-request-id",
    ]);
  });

  it("keeps the method, the body and the headers of the call", async () => {
    await apiFetch("/api/public/inquiries", {
      method: "POST",
      body: '{"a":1}',
      headers: new Headers({ "content-type": "application/json" }),
    });
    const request = sent();
    expect([request.method, await request.text(), request.headers.get("content-type")]).toEqual([
      "POST",
      '{"a":1}',
      "application/json",
    ]);
  });

  it("hands on the visitor's address from the page request", async () => {
    page.request = new Request("https://pr-7.example.test/", {
      headers: { "cf-connecting-ip": "203.0.113.9" },
    });
    await apiFetch("/api/public/properties", { method: "GET" });
    const request = sent();
    expect(request.headers.get("cf-connecting-ip")).toBe("203.0.113.9");
  });

  it("sends no address when the page request had none", async () => {
    await apiFetch("/api/public/properties", { method: "GET" });
    const request = sent();
    expect(request.headers.has("cf-connecting-ip")).toBe(false);
  });

  it("answers with the pipeline's response", async () => {
    handlePublic.mockResolvedValue(new Response('["x"]', { status: 404 }));
    const response = await apiFetch("/api/public/properties", { method: "GET" });
    expect([response.status, await response.text()]).toEqual([404, '["x"]']);
  });

  it("refuses to run without the id of the page request, and mints none", async () => {
    start.context = undefined;
    await expect(apiFetch("/api/public/properties", { method: "GET" })).rejects.toThrow();
    expect(handlePublic).not.toHaveBeenCalled();
  });
});
