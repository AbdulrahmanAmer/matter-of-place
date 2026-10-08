import "../fixtures/worker-env";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Json } from "../../src/db";
import { fakeDb } from "../fixtures/fake-db";

const BASE = "https://matterofplace.com";
const JSON_KEY = (release: string, version: number, path: string) =>
  `https://cache.mop.internal/${release}/v${String(version)}/json${path}`;

function stateJson(version: number): Json {
  return {
    catalog_version: version,
    flags: {},
    coming_soon_global: false,
    coming_soon_markets: {},
    site: null,
    illustrative_content: false,
  };
}

function fakeCache() {
  const store = new Map<string, Response>();
  const puts: string[] = [];
  const cache = {
    match: (key: string) => Promise.resolve(store.get(key)?.clone()),
    put: (key: string, response: Response) => {
      puts.push(key);
      store.set(key, response.clone());
      return Promise.resolve();
    },
  };
  return { store, puts, install: () => vi.stubGlobal("caches", { default: cache }) };
}

/** A fresh module per test: the last-good bookkeeping and the state memo live in module state. */
async function load() {
  vi.resetModules();
  return {
    cache: await import("../../src/server/public/cache"),
    pipeline: await import("../../src/server/lib/pipeline"),
    errors: await import("../../src/server/lib/errors"),
  };
}

const served = (version: number) => fakeDb({ rpc: { public_state: () => stateJson(version) } });
const failing = () => fakeDb({ rpc: { public_state: () => new Error("down") } });
const get = (path: string, init?: RequestInit) => new Request(`${BASE}${path}`, init);
const EDGE = { sMaxAge: 31_536_000, tags: ["catalog", "property:p1"] };
const body = (text = "[]") =>
  Response.json(JSON.parse(text) as unknown, { headers: { "x-request-id": "r-1" } });

beforeEach(() => {
  vi.stubEnv("SENTRY_RELEASE", "r1");
  vi.stubEnv("CATALOG_VERSION_TTL_MS", "15000");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("a JSON read", () => {
  it("builds on a miss, stores under the versioned key and answers a hit from the store", async () => {
    const { cache } = await load();
    const edge = fakeCache();
    edge.install();
    const build = vi.fn(() => Promise.resolve(body()));
    const first = await cache.edgeCached(get("/api/public/properties"), served(7), build, EDGE);
    const second = await cache.edgeCached(get("/api/public/properties"), served(7), build, EDGE);
    expect(first.headers.get("x-mop-cache")).toBe("miss");
    expect(second.headers.get("x-mop-cache")).toBe("hit");
    expect(first.headers.get("x-catalog-version")).toBe("7");
    expect(build).toHaveBeenCalledTimes(1);
    expect([...edge.store.keys()]).toContain(JSON_KEY("r1", 7, "/api/public/properties"));
  });

  it("drops the query string from the key", async () => {
    const { cache } = await load();
    const edge = fakeCache();
    edge.install();
    const build = vi.fn(() => Promise.resolve(body()));
    await cache.edgeCached(get("/api/public/properties?x=1"), served(7), build, EDGE);
    const second = await cache.edgeCached(
      get("/api/public/properties?x=2"),
      served(7),
      build,
      EDGE,
    );
    expect(second.headers.get("x-mop-cache")).toBe("hit");
    expect(build).toHaveBeenCalledTimes(1);
  });

  it("changes the key with the catalog version and with the release", async () => {
    const { cache } = await load();
    const edge = fakeCache();
    edge.install();
    const build = vi.fn(() => Promise.resolve(body()));
    await cache.edgeCached(get("/api/public/properties"), served(7), build, EDGE);
    vi.stubEnv("CATALOG_VERSION_TTL_MS", "0");
    const next = await cache.edgeCached(get("/api/public/properties"), served(8), build, EDGE);
    expect(next.headers.get("x-mop-cache")).toBe("miss");
    expect([...edge.store.keys()]).toContain(JSON_KEY("r1", 8, "/api/public/properties"));
    vi.stubEnv("SENTRY_RELEASE", "r2");
    const other = await cache.edgeCached(get("/api/public/properties"), served(8), build, EDGE);
    expect(other.headers.get("x-mop-cache")).toBe("miss");
    expect(build).toHaveBeenCalledTimes(3);
  });

  it.each([
    ["no-store", () => new Response("[]", { headers: { "cache-control": "no-store" } })],
    ["a cookie", () => new Response("[]", { headers: { "set-cookie": "a=b" } })],
    ["a 500", () => new Response("[]", { status: 500 })],
    ["a 422", () => Response.json({ error: {} }, { status: 422 })],
  ])("never stores %s", async (_name, make) => {
    const { cache } = await load();
    const edge = fakeCache();
    edge.install();
    const build = vi.fn(() => Promise.resolve(make()));
    const first = await cache.edgeCached(get("/api/public/properties"), served(7), build, EDGE);
    await cache.edgeCached(get("/api/public/properties"), served(7), build, EDGE);
    expect(first.headers.get("x-mop-cache")).toBe("bypass");
    expect(edge.puts).toEqual([]);
    expect(build).toHaveBeenCalledTimes(2);
  });

  it("stores a copy without the request id and sends the browser's lifetime, never the edge's", async () => {
    const { cache, pipeline } = await load();
    const edge = fakeCache();
    edge.install();
    const build = () => Promise.resolve(body());
    const miss = await cache.edgeCached(get("/api/public/properties"), served(7), build, EDGE);
    const hit = await cache.edgeCached(get("/api/public/properties"), served(7), build, EDGE);
    const stored = edge.store.get(JSON_KEY("r1", 7, "/api/public/properties"));
    expect(stored?.headers.get("x-request-id")).toBeNull();
    expect(stored?.headers.get("cache-control")).toMatch(/s-maxage=31536000$/);
    expect(miss.headers.get("cache-control")).toBe(pipeline.browserCacheControl("json"));
    expect(hit.headers.get("cache-control")).toBe(pipeline.browserCacheControl("json"));
    expect(hit.headers.get("x-request-id")).toBeNull();
  });

  it("tags the entry, gives it a weak ETag and answers 304 to a matching If-None-Match", async () => {
    const { cache } = await load();
    fakeCache().install();
    const build = () => Promise.resolve(body("[1]"));
    const first = await cache.edgeCached(get("/api/public/properties/p1"), served(7), build, EDGE);
    expect(first.headers.get("cache-tag")).toBe("catalog,property:p1");
    const etag = first.headers.get("etag") ?? "";
    expect(etag).toMatch(/^W\/"cv7-[0-9a-f]{16}"$/);
    const again = await cache.edgeCached(
      get("/api/public/properties/p1", { headers: { "if-none-match": etag } }),
      served(7),
      build,
      EDGE,
    );
    expect(again.status).toBe(304);
    expect(await again.text()).toBe("");
    expect(again.headers.get("x-mop-cache")).toBe("hit");
  });

  it("stores the cacheable 404 and answers it with its own short lifetime", async () => {
    const { cache } = await load();
    const edge = fakeCache();
    edge.install();
    const missing = () =>
      Promise.resolve(
        Response.json(
          { error: { code: "not_found", message: "No." } },
          { status: 404, headers: { "cache-control": "public, s-maxage=60" } },
        ),
      );
    const first = await cache.edgeCached(
      get("/api/public/properties/nope"),
      served(7),
      missing,
      EDGE,
    );
    const second = await cache.edgeCached(
      get("/api/public/properties/nope"),
      served(7),
      missing,
      EDGE,
    );
    expect(first.status).toBe(404);
    expect(first.headers.get("cache-control")).toBe("public, s-maxage=60");
    expect(second.headers.get("x-mop-cache")).toBe("hit");
    expect(edge.puts).toContain(JSON_KEY("r1", 7, "/api/public/properties/nope"));
  });

  it("answers a miss with no edge cache at all, as `vite dev` and workers.dev do", async () => {
    const { cache } = await load();
    const build = vi.fn(() => Promise.resolve(body()));
    const first = await cache.edgeCached(get("/api/public/properties"), served(7), build, EDGE);
    const second = await cache.edgeCached(get("/api/public/properties"), served(7), build, EDGE);
    expect([first, second].map((response) => response.headers.get("x-mop-cache"))).toEqual([
      "miss",
      "miss",
    ]);
    expect(build).toHaveBeenCalledTimes(2);
  });

  it("does not store a write", async () => {
    const { cache } = await load();
    const edge = fakeCache();
    edge.install();
    const response = await cache.cachedResponse(
      get("/api/public/properties", { method: "POST" }),
      "json",
      () => Promise.resolve(body()),
      EDGE,
      served(7),
    );
    expect(response.headers.get("x-mop-cache")).toBe("bypass");
    expect(edge.puts).toEqual([]);
  });
});

describe("a draft preview (B7 invariant 17 f)", () => {
  it.each([
    ["json", "/api/public/properties/p1?draft_token=token-of-sixteen-plus"],
    ["json", "/api/public/properties/p1?preview=token-of-sixteen-plus"],
    ["html", "/property/p1?preview=token-of-sixteen-plus"],
    ["html", "/property/p1?draft_token=token-of-sixteen-plus"],
  ] as const)(
    "a %s read of %s never looks up, never stores and reads no state",
    async (kind, path) => {
      const { cache } = await load();
      const match = vi.fn(() => Promise.resolve(undefined));
      const put = vi.fn(() => Promise.resolve());
      vi.stubGlobal("caches", { default: { match, put } });
      const db = served(7);
      const response = await cache.cachedResponse(
        get(path),
        kind,
        () => Promise.resolve(body()),
        EDGE,
        db,
      );
      expect(response.headers.get("x-mop-cache")).toBe("bypass");
      expect({
        match: match.mock.calls.length,
        put: put.mock.calls.length,
        db: db.calls.length,
      }).toEqual({
        match: 0,
        put: 0,
        db: 0,
      });
    },
  );
});

describe("a stored entry while the state is stale", () => {
  it("answers a stored entry as stale while the state is stale", async () => {
    vi.stubEnv("CATALOG_VERSION_TTL_MS", "0");
    const { cache } = await load();
    fakeCache().install();
    const build = () => Promise.resolve(body());
    const answers = { state: stateJson(7) as Json | Error };
    const db = fakeDb({ rpc: { public_state: () => answers.state } });
    await cache.edgeCached(get("/api/public/properties"), db, build, EDGE);
    answers.state = new Error("down");
    const stale = await cache.edgeCached(get("/api/public/properties"), db, build, EDGE);
    expect(stale.headers.get("x-mop-cache")).toBe("stale");
    expect(stale.headers.get("x-catalog-version")).toBe("7");
  });
});

describe("an HTML page", () => {
  const page = () =>
    Promise.resolve(
      new Response("<html></html>", {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "content-security-policy-report-only": "default-src 'none'; script-src 'sha256-abc'",
          link: "</fonts/a.woff2>; rel=preload",
          "x-request-id": "r-1",
          "x-frame-options": "DENY",
        },
      }),
    );

  it("keeps the policy and the preloads with the entry and answers a hit with the same values", async () => {
    const { cache } = await load();
    const edge = fakeCache();
    edge.install();
    await cache.cachedResponse(get("/california"), "html", page, undefined, served(7));
    const hit = await cache.cachedResponse(get("/california"), "html", page, undefined, served(7));
    const stored = edge.store.get("https://cache.mop.internal/r1/v7/html/california");
    expect(stored?.headers.get("content-security-policy-report-only")).toBe(
      "default-src 'none'; script-src 'sha256-abc'",
    );
    expect(stored?.headers.get("link")).toBe("</fonts/a.woff2>; rel=preload");
    expect(stored?.headers.get("x-request-id")).toBeNull();
    expect(stored?.headers.get("x-frame-options")).toBeNull();
    expect(hit.headers.get("x-mop-cache")).toBe("hit");
    expect(hit.headers.get("link")).toBe("</fonts/a.woff2>; rel=preload");
    expect(hit.headers.get("content-security-policy-report-only")).toContain("sha256-abc");
    expect(hit.headers.get("x-frame-options")).toBeNull();
  });
});

describe("the last good copy", () => {
  it("is written once per path and version, under a key with the release for HTML and without for JSON", async () => {
    const { cache } = await load();
    const edge = fakeCache();
    edge.install();
    const build = () => Promise.resolve(body());
    await cache.cachedResponse(
      get("/california"),
      "html",
      () => Promise.resolve(new Response("<p>")),
      undefined,
      served(7),
    );
    await cache.edgeCached(get("/api/public/properties"), served(7), build, EDGE);
    const htmlKey = "https://cache.mop.internal/last-good/r1/html/california";
    const jsonKey = "https://cache.mop.internal/last-good/json/api/public/properties";
    expect(edge.store.get(htmlKey)?.headers.get("cache-control")).toMatch(/s-maxage=604800$/);
    expect(edge.store.has(jsonKey)).toBe(true);
    edge.store.delete(JSON_KEY("r1", 7, "/api/public/properties"));
    edge.puts.length = 0;
    await cache.edgeCached(get("/api/public/properties"), served(7), build, EDGE);
    expect(edge.puts).toEqual([JSON_KEY("r1", 7, "/api/public/properties")]);
  });

  it("answers `stale` when the state cannot be read and a copy exists, and 503 when none does", async () => {
    const first = await load();
    const edge = fakeCache();
    edge.install();
    await first.cache.edgeCached(
      get("/api/public/properties"),
      served(7),
      () => Promise.resolve(body("[7]")),
      EDGE,
    );
    await first.cache.cachedResponse(
      get("/california"),
      "html",
      () => Promise.resolve(new Response("<p>")),
      undefined,
      served(7),
    );
    // A new isolate, a new release, and a database that does not answer.
    vi.stubEnv("SENTRY_RELEASE", "r2");
    const { cache, errors } = await load();
    const json = await cache.edgeCached(
      get("/api/public/properties"),
      failing(),
      () => Promise.resolve(body()),
      EDGE,
    );
    expect(json.headers.get("x-mop-cache")).toBe("stale");
    expect(await json.json()).toEqual([7]);
    const html = cache.cachedResponse(
      get("/california"),
      "html",
      () => Promise.resolve(new Response("<p>")),
      undefined,
      failing(),
    );
    await expect(html).rejects.toBeInstanceOf(errors.AppError);
    await expect(html).rejects.toMatchObject({ code: "unavailable", status: 503 });
  });

  it("is read when the build fails because the database is unavailable, and only then", async () => {
    const { cache, errors } = await load();
    const edge = fakeCache();
    edge.install();
    await cache.edgeCached(
      get("/api/public/properties"),
      served(7),
      () => Promise.resolve(body("[1]")),
      EDGE,
    );
    edge.store.delete(JSON_KEY("r1", 7, "/api/public/properties"));
    const unavailable = () => Promise.reject(new errors.AppError("unavailable", undefined, "down"));
    const stale = await cache.edgeCached(
      get("/api/public/properties"),
      served(7),
      unavailable,
      EDGE,
    );
    expect(stale.headers.get("x-mop-cache")).toBe("stale");
    const broken = () => Promise.reject(new Error("a bug"));
    await expect(
      cache.edgeCached(get("/api/public/properties"), served(7), broken, EDGE),
    ).rejects.toThrow("a bug");
  });

  it("is not written from an answer built while the state was stale", async () => {
    const { cache } = await load();
    const edge = fakeCache();
    edge.install();
    const warm = served(7);
    await cache.edgeCached(
      get("/api/public/properties"),
      warm,
      () => Promise.resolve(body()),
      EDGE,
    );
    vi.stubEnv("CATALOG_VERSION_TTL_MS", "0");
    edge.puts.length = 0;
    const answer = await cache.edgeCached(
      get("/api/public/properties/other"),
      failing(),
      () => Promise.resolve(body()),
      EDGE,
    );
    expect(answer.headers.get("x-mop-cache")).toBe("stale");
    expect(edge.puts).toEqual([]);
  });
});

describe("mediaCached", () => {
  it("keys the file by its own URL without the query and stores it as immutable", async () => {
    const { cache } = await load();
    const edge = fakeCache();
    edge.install();
    const build = vi.fn(() =>
      Promise.resolve(new Response("webp", { headers: { "content-type": "image/webp" } })),
    );
    const first = await cache.mediaCached(
      new Request(`${BASE}/media/v/p1/1-ab12cd34/hero.webp`),
      build,
    );
    const second = await cache.mediaCached(
      new Request(`${BASE}/media/v/p1/1-ab12cd34/hero.webp?v=2`),
      build,
    );
    expect(first.headers.get("x-mop-cache")).toBe("miss");
    expect(second.headers.get("x-mop-cache")).toBe("hit");
    expect(second.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(second.headers.get("content-type")).toBe("image/webp");
    expect(build).toHaveBeenCalledTimes(1);
    expect([...edge.store.keys()]).toEqual([`${BASE}/media/v/p1/1-ab12cd34/hero.webp`]);
  });

  it("passes any other answer through as no-store and never stores it", async () => {
    const { cache } = await load();
    const edge = fakeCache();
    edge.install();
    const build = vi.fn(() => Promise.resolve(Response.json({ error: {} }, { status: 404 })));
    const first = await cache.mediaCached(new Request(`${BASE}/media/o/none`), build);
    await cache.mediaCached(new Request(`${BASE}/media/o/none`), build);
    expect(first.status).toBe(404);
    expect(first.headers.get("cache-control")).toBe("no-store");
    expect(edge.puts).toEqual([]);
    expect(build).toHaveBeenCalledTimes(2);
  });
});
