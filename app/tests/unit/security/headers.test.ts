import "../../fixtures/worker-env";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PipelineContext, PipelineDeps } from "../../../src/server/lib/pipeline";
import { fakeDb } from "../../fixtures/fake-db";

// H1-04 (architecture 13 rules 5 and 6): a cached page leaves with the policy that was computed from its own inline
// scripts at render and stored with it, hashes only, and every class of rule 6 answers exactly `no-store`.

const BASE = "https://matterofplace.com";
const PAGE = [
  "<!doctype html><html><head><style>body{margin:0}</style></head><body>",
  '<script class="$tsr">window.$_TSR={}</script>',
  '<script type="application/ld+json">{"@context":"https://schema.org"}</script>',
  '<script src="/assets/app.js"></script></body></html>',
].join("");
const ENFORCING = "content-security-policy";
const REPORT_ONLY = "content-security-policy-report-only";

function fakeCache() {
  const store = new Map<string, Response>();
  vi.stubGlobal("caches", {
    default: {
      match: (key: string) => Promise.resolve(store.get(key)?.clone()),
      put: (key: string, response: Response) => {
        store.set(key, response.clone());
        return Promise.resolve();
      },
    },
  });
  return store;
}

type Flags = Record<string, boolean>;

const stateJson = (flags: Flags) => ({
  catalog_version: 7,
  flags,
  coming_soon_global: false,
  coming_soon_markets: {},
  site: null,
  illustrative_content: false,
});

/** A fresh module graph per test: the state memo and the last-good bookkeeping live in module state. */
async function pipelineWith(flags: Flags, render: PipelineDeps["render"]) {
  vi.resetModules();
  const { handle } = await import("../../../src/server/lib/pipeline");
  const { cachedResponse } = await import("../../../src/server/public/cache");
  const db = fakeDb({ rpc: { public_state: () => stateJson(flags) } });
  const ctx: PipelineContext = { env: { MOP_ENV: "production" }, waitUntil: () => undefined };
  const deps: PipelineDeps = {
    render,
    redirect: () => Promise.resolve(null),
    cache: (request, build) => cachedResponse(request, "html", build, undefined, db),
    getFlags: () => Promise.resolve(flags),
    report: () => Promise.resolve(),
    isApiRoute: (pathname) => pathname === "/api/public/properties",
  };
  return (request: Request) => handle(request, ctx, deps);
}

const html = (status = 200, headers: Record<string, string> = {}) =>
  new Response(PAGE, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=600",
      ...headers,
    },
  });

beforeEach(() => {
  vi.stubEnv("SENTRY_RELEASE", "r1");
  vi.stubEnv("CATALOG_VERSION_TTL_MS", "15000");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("the policy of a cached page", () => {
  it.each([
    { mode: "report-only", flags: {}, name: REPORT_ONLY, other: ENFORCING },
    { mode: "enforcing", flags: { csp_enforce: true }, name: ENFORCING, other: REPORT_ONLY },
  ])(
    "is the $mode header stored with the entry, with hashes and no nonce or unsafe-inline",
    async ({ flags, name, other }) => {
      const store = fakeCache();
      const run = await pipelineWith(flags, () => Promise.resolve(html()));
      const miss = await run(new Request(`${BASE}/`));
      const hit = await run(new Request(`${BASE}/`));
      const stored = [...store.entries()].find(([key]) => key.includes("/v7/html/"))?.[1];
      const policy = miss.headers.get(name) ?? "";
      expect([miss.headers.get("x-mop-cache"), hit.headers.get("x-mop-cache")]).toEqual([
        "miss",
        "hit",
      ]);
      expect(policy).toMatch(/script-src [^;]*'sha256-[A-Za-z0-9+/]+=*'/);
      expect(policy).toMatch(/style-src [^;]*'sha256-[A-Za-z0-9+/]+=*'/);
      expect(policy).not.toContain("nonce-");
      expect(policy).not.toContain("'unsafe-inline'");
      expect(stored?.headers.get(name)).toBe(policy);
      expect(hit.headers.get(name)).toBe(policy);
      expect([miss.headers.get(other), hit.headers.get(other)]).toEqual([null, null]);
    },
  );

  it("hashes the inline scripts of a not-found page too, which hydrates like any page", async () => {
    fakeCache();
    const run = await pipelineWith({ csp_enforce: true }, () => Promise.resolve(html(404)));
    const response = await run(new Request(`${BASE}/no-such-page`));
    expect(response.status).toBe(404);
    expect(response.headers.get(ENFORCING)).toMatch(/script-src [^;]*'sha256-[A-Za-z0-9+/]+=*'/);
  });
});

describe("rule 6: never cached", () => {
  const routerRefusal = () =>
    Response.json({ error: "Only HTML requests are supported here" }, { status: 500 });
  const cases: { name: string; request: Request; render: () => Response }[] = [
    {
      name: "a public write",
      request: new Request(`${BASE}/api/public/inquiries`, { method: "POST", body: "{}" }),
      render: () =>
        Response.json(
          { id: "x" },
          { status: 201, headers: { "cache-control": "public, max-age=600" } },
        ),
    },
    {
      name: "an admin API read",
      request: new Request(`${BASE}/api/admin/me`),
      render: () =>
        Response.json({ id: "x" }, { headers: { "cache-control": "public, max-age=600" } }),
    },
    {
      name: "a hook",
      request: new Request(`${BASE}/api/hooks/resend`, { method: "POST", body: "{}" }),
      render: () =>
        Response.json({ ok: true }, { headers: { "cache-control": "public, max-age=600" } }),
    },
    { name: "the admin page", request: new Request(`${BASE}/admin`), render: () => html() },
    {
      name: "an admin screen",
      request: new Request(`${BASE}/admin/properties`),
      render: () => html(),
    },
    {
      name: "a preview link",
      request: new Request(`${BASE}/properties/a?preview=tok`),
      render: () => html(),
    },
    {
      name: "a draft token",
      request: new Request(`${BASE}/stories/a?draft_token=tok`),
      render: () => html(),
    },
    {
      name: "a page that sets a cookie",
      request: new Request(`${BASE}/about`),
      render: () => html(200, { "set-cookie": "a=b" }),
    },
    {
      name: "the pipeline's own 405",
      request: new Request(`${BASE}/api/public/properties`),
      render: () => html(),
    },
    {
      name: "the pipeline's own 404",
      request: new Request(`${BASE}/api/public/nothing`),
      render: () => html(404),
    },
    {
      name: "the pipeline's own 406",
      request: new Request(`${BASE}/about`, { headers: { accept: "application/json" } }),
      render: routerRefusal,
    },
    { name: "a 503", request: new Request(`${BASE}/about`), render: () => html(503) },
  ];

  it.each(cases)("answers $name with exactly no-store", async ({ request, render }) => {
    fakeCache();
    const run = await pipelineWith({}, () => Promise.resolve(render()));
    expect((await run(request)).headers.get("cache-control")).toBe("no-store");
  });

  it("answers a thrown render with a 500 and exactly no-store", async () => {
    fakeCache();
    const run = await pipelineWith({}, () => Promise.reject(new Error("render failed")));
    const response = await run(new Request(`${BASE}/api/public/stories`));
    expect([response.status, response.headers.get("cache-control")]).toEqual([500, "no-store"]);
  });

  it("leaves a public page cacheable, so the cases above measure the rule", async () => {
    fakeCache();
    const run = await pipelineWith({}, () => Promise.resolve(html()));
    expect((await run(new Request(`${BASE}/about`))).headers.get("cache-control")).toBe(
      "public, max-age=0, must-revalidate",
    );
  });
});
