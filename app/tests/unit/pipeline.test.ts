import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { serverErrorHtml } from "../../src/server/lib/error-page";
import { AppError } from "../../src/server/lib/errors";
import { securityHeaders } from "../../src/server/lib/headers";
import {
  browserCacheControl,
  handle,
  isPageRequest,
  neverCached,
  type PipelineContext,
  type PipelineDeps,
} from "../../src/server/lib/pipeline";

vi.mock("../../src/server/lib/headers", { spy: true });

const CSP = "content-security-policy-report-only";
const REPORT_ONLY = "default-src 'none'; script-src 'sha256-abc'";
const BASE = "https://matterofplace.com";

function memoryCache() {
  const store = new Map<string, Response>();
  const calls: string[] = [];
  const hook: PipelineDeps["cache"] = async (request, render) => {
    const key = new URL(request.url).pathname;
    calls.push(`${request.method} ${key}`);
    const hit = store.get(key);
    if (hit) return hit.clone();
    const response = await render();
    store.set(key, response.clone());
    return response;
  };
  return { store, calls, hook };
}

function setup(options: {
  env?: string | undefined;
  render?: (request: Request) => Response | Promise<Response>;
  cache?: PipelineDeps["cache"];
  redirect?: PipelineDeps["redirect"];
  getFlags?: PipelineDeps["getFlags"];
  apiRoutes?: string[];
}) {
  const waitUntil = vi.fn<PipelineContext["waitUntil"]>();
  const report = vi.fn<PipelineDeps["report"]>(() => Promise.resolve());
  const rendered: string[] = [];
  const renderIds: string[] = [];
  const ctx: PipelineContext = { env: { MOP_ENV: options.env }, waitUntil };
  const deps: PipelineDeps = {
    render: (request, requestId) => {
      renderIds.push(requestId);
      rendered.push(`${request.method} ${new URL(request.url).pathname}`);
      return Promise.resolve(options.render?.(request) ?? new Response("<html></html>"));
    },
    redirect: options.redirect ?? (() => Promise.resolve(null)),
    cache: options.cache ?? ((_request, render) => render()),
    getFlags: options.getFlags ?? (() => Promise.resolve({})),
    report,
    isApiRoute: (pathname) => (options.apiRoutes ?? []).includes(pathname),
  };
  return {
    rendered,
    renderIds,
    waitUntil,
    report,
    run: (request: Request) => handle(request, ctx, deps),
  };
}

const get = (path: string, init?: RequestInit) => new Request(`${BASE}${path}`, init);

const errorLines: string[] = [];

beforeEach(() => {
  errorLines.length = 0;
  vi.spyOn(console, "error").mockImplementation((line: unknown) => {
    errorLines.push(String(line));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("rule 5: nothing per visitor is stored", () => {
  it("never stores the request id or a security header, and returns both", async () => {
    const cache = memoryCache();
    const { run } = setup({ cache: cache.hook });
    const response = await run(get("/california"));
    expect(response.headers.get("x-request-id")).not.toBeNull();
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    const stored = cache.store.get("/california");
    expect(stored?.headers.get("x-request-id")).toBeNull();
    expect(stored?.headers.get("x-frame-options")).toBeNull();
    expect(stored?.headers.get(CSP)).toBeNull();
  });

  it("gives two requests to the same page two request ids", async () => {
    const cache = memoryCache();
    const { run } = setup({ cache: cache.hook });
    const first = await run(get("/california"));
    const second = await run(get("/california"));
    expect(first.headers.get("x-request-id")).not.toBe(second.headers.get("x-request-id"));
  });

  it("calls the cache hook before render and skips render on a hit", async () => {
    const cache = memoryCache();
    const { run, rendered } = setup({ cache: cache.hook });
    await run(get("/california"));
    await run(get("/california"));
    expect(cache.calls).toEqual(["GET /california", "GET /california"]);
    expect(rendered).toEqual(["GET /california"]);
  });
});

describe("request id", () => {
  it("keeps an inbound id that matches the pattern", async () => {
    const id = "6f1c2f3a-0b1d-4c8e-9a52-1d3f5b7c9e01";
    const { run } = setup({});
    const response = await run(get("/", { headers: { "x-request-id": id } }));
    expect(response.headers.get("x-request-id")).toBe(id);
  });

  it.each(["abc", "abc; Set-Cookie: x", "a".repeat(65), "café-café-café"])(
    "replaces an inbound id that does not match: %s",
    async (inbound) => {
      const { run } = setup({});
      const response = await run(get("/", { headers: { "x-request-id": inbound } }));
      expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    },
  );

  it("gives the handler the id of the x-request-id header (H39 (1))", async () => {
    const { run, renderIds } = setup({});
    const response = await run(get("/api/hooks/sentry-test", { method: "POST" }));
    expect(renderIds).toEqual([response.headers.get("x-request-id")]);
  });
});

describe("a path under /api/ never answers the page shell (H39 (2))", () => {
  const shell =
    (status: number, type = "text/html; charset=utf-8") =>
    () =>
      new Response("<!doctype html><html></html>", { status, headers: { "content-type": type } });
  const body = z.object({
    error: z.object({ code: z.string(), message: z.string(), requestId: z.string() }),
  });

  it.each([
    ["/api/hooks/sentry-test", "text/html; charset=utf-8"],
    ["/api/public/markets", "Text/HTML"],
  ])("answers GET %s rendered as a %s page with the R09 405", async (path, type) => {
    const response = await setup({ render: shell(200, type) }).run(get(path));
    expect(response.status).toBe(405);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body.parse(await response.json()).error).toEqual({
      code: "method_not_allowed",
      message: "This address does not accept that method.",
      requestId: response.headers.get("x-request-id"),
    });
  });

  it.each([
    "/API/hooks/sentry-test",
    "/Api/hooks/sentry-test",
    "/%61pi/hooks/sentry-test",
    "//api/hooks/sentry-test",
  ])("answers GET %s, which the router matches as /api/, with the R09 405", async (path) => {
    const response = await setup({ render: shell(200) }).run(get(path));
    expect(response.status).toBe(405);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body.parse(await response.json()).error.code).toBe("method_not_allowed");
  });

  it("answers a page shell of 404 under /api/ with the R09 404", async () => {
    const response = await setup({ render: shell(404) }).run(get("/api/hooks/nothing-here"));
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body.parse(await response.json()).error).toMatchObject({
      code: "not_found",
      requestId: response.headers.get("x-request-id"),
    });
  });

  it("leaves a page and an API answer that is not HTML untouched", async () => {
    const page = await setup({ render: shell(200) }).run(get("/california"));
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toBe("text/html; charset=utf-8");
    const json = await setup({ render: () => Response.json({ ok: true }) }).run(
      get("/api/public/markets"),
    );
    expect(json.status).toBe(200);
    expect(await json.json()).toEqual({ ok: true });
  });

  // What Start's executeRouter answers once no handler took a request with that Accept.
  const refusal = () =>
    Response.json({ error: "Only HTML requests are supported here" }, { status: 500 });

  it.each([
    ["GET", "application/json", 405, "method_not_allowed"],
    ["DELETE", "text/plain", 405, "method_not_allowed"],
    ["GET", "application/json", 405, "method_not_allowed", "/%61pi/Hooks/sentry-test"],
    ["GET", "application/json", 404, "not_found", "/api/hooks/nothing-here"],
    ["POST", "application/json", 404, "not_found", "/api/hooks/nothing-here"],
  ])(
    "answers the router's refusal of %s with Accept %s with the R09 %i",
    async (method, accept, status, code, path = "/api/hooks/sentry-test") => {
      const { run } = setup({ render: refusal, apiRoutes: ["/api/hooks/sentry-test"] });
      const response = await run(get(path, { method, headers: { accept } }));
      expect(response.status).toBe(status);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(body.parse(await response.json()).error).toMatchObject({
        code,
        requestId: response.headers.get("x-request-id"),
      });
    },
  );

  it.each([
    [
      "a handler's R09 500",
      () =>
        Response.json({ error: { code: "server", message: "x", requestId: "r" } }, { status: 500 }),
      "application/json",
    ],
    ["a 500 that is not JSON", () => new Response("boom", { status: 500 }), "application/json"],
    ["a 200 with an error field", () => Response.json({ error: "a field" }), "application/json"],
    ["a 500 to a client that accepts HTML", refusal, "text/html, application/json"],
    ["a 500 to an empty Accept, which Start reads as */*", refusal, ""],
  ])("keeps %s as it is", async (_label, render, accept) => {
    const rendered = await render().clone().text();
    const response = await setup({ render, apiRoutes: ["/api/public/markets"] }).run(
      get("/api/public/markets", { headers: { accept } }),
    );
    expect([response.status, await response.text()]).toEqual([render().status, rendered]);
  });

  it("answers a page asked for with Accept application/json with the R09 406", async () => {
    const response = await setup({ render: refusal }).run(
      get("/california", { headers: { accept: "application/json" } }),
    );
    expect(response.status).toBe(406);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(body.parse(await response.json()).error).toEqual({
      code: "not_acceptable",
      message: "This address answers with a web page only.",
      requestId: response.headers.get("x-request-id"),
    });
  });

  it("leaves a page asked for with Accept text/html as it is", async () => {
    const response = await setup({ render: shell(200) }).run(
      get("/california", { headers: { accept: "text/html" } }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
  });
});

describe("rule 6: never cached", () => {
  const cases: [string, string, string][] = [
    ["POST", "/california", "a POST"],
    ["POST", "/api/public/inquiries", "a write under /api/public"],
    ["GET", "/api/admin/properties", "an admin read"],
    ["GET", "/api/hooks/resend", "a hook"],
    ["GET", "/admin", "the admin page"],
    ["GET", "/ADMIN", "the admin page in capitals"],
    ["GET", "/API/hooks/sentry-test", "a hook in capitals"],
    ["GET", "/Api/Admin/properties", "an admin read in mixed case"],
    ["GET", "/%61pi/hooks/resend", "a hook with an escaped letter"],
    ["GET", "/api/hoo%E2%84%AAs/resend", "a hook spelled with the Kelvin sign"],
    ["GET", "/api/hoo%E2%84%AAs/x%25%E0", "the same beside a malformed escape"],
  ];

  it.each(cases)("forces no-store on %s %s (%s)", async (method, path) => {
    const { run } = setup({});
    const response = await run(get(path, { method }));
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("forces no-store on a response with Set-Cookie", async () => {
    const { run } = setup({
      render: () => new Response("ok", { headers: { "set-cookie": "a=b" } }),
    });
    expect((await run(get("/california"))).headers.get("cache-control")).toBe("no-store");
  });

  it("forces no-store on a 500", async () => {
    const { run } = setup({ render: () => new Response("boom", { status: 502 }) });
    expect((await run(get("/california"))).headers.get("cache-control")).toBe("no-store");
  });

  it.each([
    ["POST", "/api/public/inquiries"],
    ["GET", "/api/admin/properties"],
  ])(
    "replaces the handler's Cache-Control on %s %s with exactly no-store (G65)",
    async (method, path) => {
      const { run } = setup({
        render: () => new Response("{}", { headers: { "cache-control": "public, max-age=60" } }),
      });
      const response = await run(get(path, { method }));
      expect(response.headers.get("cache-control")).toBe("no-store");
    },
  );

  it.each(["/property/x?preview=t", "/api/public/properties/x?draft_token=t"])(
    "skips the cache hook and answers no-store for a preview token: %s",
    async (path) => {
      const cache = memoryCache();
      const { run } = setup({ cache: cache.hook });
      const response = await run(get(path));
      expect(cache.calls).toEqual([]);
      expect(response.headers.get("cache-control")).toBe("no-store");
    },
  );

  it("answers the browser with the html lifetime on a page, whatever the stored copy said", async () => {
    const { run } = setup({
      render: () =>
        new Response("<html></html>", {
          headers: { "cache-control": "public, s-maxage=31536000" },
        }),
    });
    const response = await run(get("/california"));
    expect(response.headers.get("cache-control")).toBe("public, max-age=0, must-revalidate");
  });

  it.each([
    ["/api/public/markets", "public, max-age=60"],
    ["/sitemap.xml", "public, max-age=3600"],
  ])("leaves the Cache-Control of %s alone, because it is not a page", async (path, lifetime) => {
    const { run } = setup({
      render: () => new Response("x", { headers: { "cache-control": lifetime } }),
    });
    expect((await run(get(path))).headers.get("cache-control")).toBe(lifetime);
  });

  it("exposes the browser lifetime of each kind", () => {
    expect(browserCacheControl("html")).toBe("public, max-age=0, must-revalidate");
    expect(browserCacheControl("json")).toBe("public, max-age=60");
    expect(browserCacheControl("doc")).toBe("public, max-age=3600");
  });

  it("tells a request-side rule from a response-side rule", () => {
    expect(neverCached(get("/california"), "/california")).toBe(false);
    expect(neverCached(get("/california"), "/california", new Response("", { status: 503 }))).toBe(
      true,
    );
  });
});

describe("the content security policy", () => {
  it("keeps the policy a hit carries and does not add the default beside it", async () => {
    const cache = memoryCache();
    const { run } = setup({
      cache: cache.hook,
      render: () => new Response("<html></html>", { headers: { [CSP]: REPORT_ONLY } }),
    });
    await run(get("/california"));
    const hit = await run(get("/california"));
    expect(hit.headers.get(CSP)).toBe(REPORT_ONLY);
  });

  it("keeps an enforced policy and adds no report-only policy", async () => {
    const { run } = setup({
      render: () =>
        new Response("", { headers: { "content-security-policy": "default-src 'none'" } }),
    });
    const response = await run(get("/california"));
    expect(response.headers.get("content-security-policy")).toBe("default-src 'none'");
    expect(response.headers.get(CSP)).toBeNull();
  });

  it("sets the default policy on a response that has none", async () => {
    const { run } = setup({});
    const response = await run(get("/california"));
    expect(response.headers.get(CSP)).toContain("frame-ancestors 'none'");
  });
});

describe("which requests reach the cache hook", () => {
  it("sends public pages, GET and HEAD, and never a POST", async () => {
    const cache = memoryCache();
    const { run } = setup({ cache: cache.hook });
    await run(get("/california"));
    await run(get("/", { method: "HEAD" }));
    await run(get("/california", { method: "POST" }));
    expect(cache.calls).toEqual(["GET /california", "HEAD /"]);
  });

  it.each([
    "/robots.txt",
    "/sitemap.xml",
    "/feed.xml",
    "/.well-known/security.txt",
    "/.well-known/change-password",
    "/_serverFn/abc?payload=x",
    "/media/assets/p1/hero/r1/a.0123abcd.webp",
    "/media/o/p1/hero",
  ])(
    "keeps %s away from the cache hook and the redirect lookup and still adds the headers",
    async (path) => {
      const cache = memoryCache();
      const redirect = vi.fn<PipelineDeps["redirect"]>(() => Promise.resolve(null));
      const { run } = setup({ cache: cache.hook, redirect });
      const response = await run(get(path));
      expect(cache.calls).toEqual([]);
      expect(redirect).not.toHaveBeenCalled();
      expect(response.headers.get("x-request-id")).not.toBeNull();
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    },
  );

  it("tells a page from a document", () => {
    expect(isPageRequest("/california")).toBe(true);
    expect(isPageRequest("/property/oak-hill")).toBe(true);
    expect(isPageRequest("/robots.txt")).toBe(false);
    expect(isPageRequest("/api/public/markets")).toBe(false);
    expect(isPageRequest("/admin/properties")).toBe(false);
  });

  it("reads a path as the router matches it", () => {
    expect(isPageRequest("/API/admin/x")).toBe(false);
    expect(isPageRequest("/%61dmin")).toBe(false);
    expect(isPageRequest("/%41PI/x%E0")).toBe(false);
    expect(isPageRequest("//media/a")).toBe(false);
    expect(isPageRequest("/%2561pi/x")).toBe(true);
    expect(isPageRequest("/California")).toBe(true);
  });
});

describe("X-Robots-Tag by host (G19)", () => {
  const WORKERS = "holy-meadow-4327.workers.dev";
  const noindex: [string, string | undefined][] = [
    [`matter-of-place.${WORKERS}`, "production"],
    [`pr-1.${WORKERS}`, "production"],
    [`matter-of-place-dev.${WORKERS}`, "preview"],
    ["127.0.0.1:8788", "local"],
    ["127.0.0.1:8788", "preview"],
    [`Pr-1.${WORKERS.toUpperCase()}`, "production"],
    [`pr-1.${WORKERS}:443`, "production"],
  ];
  const indexable: [string, string | undefined][] = [
    ["matterofplace.com", "production"],
    ["MatterOfPlace.com:443", "production"],
    ["127.0.0.1:8788", "production"],
    ["matterofplace.com", undefined],
  ];

  it.each(noindex)("marks %s noindex under MOP_ENV %s", async (host, env) => {
    const { run } = setup({ env });
    const response = await run(get("/", { headers: { host } }));
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });

  it.each(indexable)("leaves %s alone under MOP_ENV %s", async (host, env) => {
    const { run } = setup({ env });
    const response = await run(get("/", { headers: { host } }));
    expect(response.headers.get("x-robots-tag")).toBeNull();
  });
});

describe("flags", () => {
  it("calls the reader once per page request and hands what it returns to the security headers", async () => {
    vi.mocked(securityHeaders).mockClear();
    const getFlags = vi.fn<PipelineDeps["getFlags"]>(() => Promise.resolve({ csp_enforce: true }));
    await setup({ getFlags }).run(get("/"));
    expect(getFlags).toHaveBeenCalledTimes(1);
    expect(vi.mocked(securityHeaders).mock.calls.map(([, flags]) => flags)).toEqual([
      { csp_enforce: true },
    ]);
  });

  it("wires start.ts's flags dependency to getFlags(getDb())", async () => {
    const db = { marker: "the one client" };
    const getFlags = vi.fn(() => Promise.resolve({ csp_enforce: true }));
    const handed: PipelineDeps[] = [];
    vi.resetModules();
    vi.doMock("../../src/router", () => ({ getRouter: () => ({}) }));
    vi.doMock("../../src/server/lib/env", () => ({
      env: {
        SUPABASE_URL: "https://db.invalid",
        SUPABASE_SERVICE_ROLE_KEY: "key",
        MOP_ENV: "local",
      },
      sentryOptions: () => ({}),
    }));
    vi.doMock("../../src/server/lib/db", () => ({ getDb: () => db }));
    vi.doMock("../../src/server/lib/flags", () => ({ getFlags }));
    vi.doMock("../../src/server/lib/pipeline", () => ({
      handle: (_request: Request, _ctx: PipelineContext, deps: PipelineDeps) => {
        handed.push(deps);
        return Promise.resolve(new Response("ok"));
      },
    }));
    const { startInstance } = await import("../../src/start");
    const options = await startInstance.getOptions();
    const server: unknown = Reflect.get(options.requestMiddleware?.[0]?.options ?? {}, "server");
    if (typeof server !== "function") throw new Error("start.ts registers no pipeline middleware");
    await Reflect.apply(server, undefined, [{ request: get("/"), next: () => undefined }]);
    const [deps] = handed;
    expect(await deps?.getFlags()).toEqual({ csp_enforce: true });
    expect(getFlags).toHaveBeenCalledTimes(1);
    expect(getFlags).toHaveBeenCalledWith(db);
  });
});

describe("an unhandled error", () => {
  const failing = () => {
    throw new Error("boom");
  };
  const body = z.object({
    error: z.object({ code: z.string(), message: z.string(), requestId: z.string() }),
  });

  it("answers the calm 500 once, reports it inside waitUntil and never stores it", async () => {
    const { run, waitUntil, report } = setup({ render: failing });
    const response = await run(get("/california", { headers: { accept: "text/html" } }));
    const id = response.headers.get("x-request-id");
    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0]?.[1]).toEqual({ requestId: id, route: "/california" });
    expect(waitUntil).toHaveBeenCalledTimes(1);
  });

  it("answers an outage with the calm 503 and Retry-After, and reports nothing", async () => {
    const outage = () => {
      throw new AppError("unavailable", undefined, "down");
    };
    const { run, waitUntil, report } = setup({ render: outage });
    const page = await run(get("/california", { headers: { accept: "text/html" } }));
    expect(page.status).toBe(503);
    expect(page.headers.get("retry-after")).toBe("30");
    expect(page.headers.get("cache-control")).toBe("no-store");
    expect(page.headers.get("content-type")).toContain("text/html");
    const api = await run(get("/api/public/properties"));
    expect(api.status).toBe(503);
    expect(body.parse(await api.json()).error.code).toBe("unavailable");
    expect(report).not.toHaveBeenCalled();
    expect(waitUntil).not.toHaveBeenCalled();
  });

  it("logs one unhandled_error line with the request id", async () => {
    const { run } = setup({ render: failing });
    const response = await run(get("/california"));
    expect(errorLines).toHaveLength(1);
    expect(JSON.parse(errorLines[0] ?? "")).toEqual({
      level: "error",
      event: "unhandled_error",
      requestId: response.headers.get("x-request-id"),
      route: "/california",
    });
  });

  it("answers a page request that accepts HTML with the HTML page and the id", async () => {
    const { run } = setup({ render: failing });
    const response = await run(get("/", { headers: { accept: "text/html" } }));
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await response.text()).toContain(response.headers.get("x-request-id") ?? "missing");
  });

  it("answers JSON for an API path, a write, or a client that does not accept HTML", async () => {
    for (const request of [
      get("/api/x", { headers: { accept: "text/html" } }),
      get("/", { method: "POST", headers: { accept: "text/html" } }),
      get("/", { headers: { accept: "application/json" } }),
    ]) {
      const response = await setup({ render: failing }).run(request);
      expect(response.headers.get("content-type")).toContain("application/json");
      expect(body.parse(await response.json()).error).toEqual({
        code: "server",
        message: "Something went wrong. Please try again in a moment.",
        requestId: response.headers.get("x-request-id"),
      });
    }
  });

  it("escapes the id in the HTML page", () => {
    expect(serverErrorHtml("<script>&")).toContain("Reference &lt;script&gt;&amp;");
  });
});

describe("the response object", () => {
  it("is the one the render produced, so a router redirect keeps its options", async () => {
    const rendered = new Response(null, { status: 307, headers: { location: "/exposure" } });
    const { run } = setup({ render: () => rendered });
    expect(await run(get("/pricing"))).toBe(rendered);
  });
});
