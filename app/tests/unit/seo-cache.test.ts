import "../fixtures/worker-env";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Json } from "../../src/db";
import { countingDb, type CountingDb } from "../fixtures/db-counter";
import { fakeDb } from "../fixtures/fake-db";
import { propertyJson, snapshotJson, stateJson } from "../fixtures/snapshot";

// B13 step 12 (architecture 13, F24, F25): the sitemap, robots, the two llms files, an archive page and the 410 page
// are answered through the cache module and the two readers. The database is a counting `fakeDb`, injected the way
// `setDbForTests` injects it, and the Cache API is a Map. The two HTML pages run through the real pipeline with the
// same four hooks `start.ts` passes, but their render is a stand-in for the router: it reads the catalog the way the
// archive server function does, because a unit test cannot run the server-function compiler.

const mocks = vi.hoisted(() => ({ mopEnv: "production" }));
vi.mock("../../src/server/lib/env", () => ({
  env: {
    get MOP_ENV() {
      return mocks.mopEnv;
    },
  },
}));

const BASE = "https://matterofplace.com";
const WORKERS_HOST = "matter-of-place.holy-meadow-4327.workers.dev";
const T0 = Date.UTC(2026, 9, 7, 12, 0, 0);
const TTL = 15_000;
const NEVER = "3600000000";

const SITEMAP = "/sitemap.xml";
const LLMS = "/llms.txt";
const LLMS_FULL = "/llms-full.txt";
const ROBOTS = "/robots.txt";
const ARCHIVE = "/archive/architect/fixture-architect";
const GONE = "/property/old-slug";
const DOCUMENTS = [SITEMAP, LLMS, LLMS_FULL, ROBOTS];
const PAGES = [ARCHIVE, GONE];
const ALL = [...DOCUMENTS, ...PAGES];

const INDEXABLE_ROBOTS = [
  "User-agent: *",
  "Allow: /",
  "Disallow: /admin",
  "Disallow: /api",
  "",
  "Sitemap: https://matterofplace.com/sitemap.xml",
  "",
].join("\n");
const CLOSED_ROBOTS = "User-agent: *\nDisallow: /\n";

const keyOf = (kind: "doc" | "html", version: number, path: string) =>
  `https://cache.mop.internal/r1/v${String(version)}/${kind}${path}`;

interface World {
  version: number;
  archivePages: boolean;
  comingSoon: Record<string, boolean>;
  redirects: Json[];
  slugs: string[];
  failing: boolean;
}

const newWorld = (): World => ({
  version: 7,
  archivePages: true,
  comingSoon: { california: false, "new-york": true },
  redirects: [],
  slugs: ["p1", "p2", "p3"],
  failing: false,
});

const record = (value: Json): Record<string, Json | undefined> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("fixture is not an object");
  }
  return value;
};
const row = (slug: string, extra: Record<string, Json>): Json => ({
  ...record(propertyJson(slug)),
  ...extra,
});
// Three properties by one architect make one archive page; the New York one shares no facet with them.
const propertiesOf = (world: World): Json[] => [
  ...world.slugs.map((slug) =>
    row(slug, slug === "p4" ? { style: "Ranch" } : { architect: "Fixture Architect" }),
  ),
  row("ny1", {
    market_slug: "new-york",
    state: "New York",
    city: "Brooklyn",
    style: "Brutalist",
  }),
];

const clientFor = (world: World): CountingDb =>
  countingDb(
    fakeDb({
      rpc: {
        public_state: () =>
          world.failing
            ? new Error("down")
            : stateJson(world.version, {
                flags: { archive_pages: world.archivePages },
                coming_soon_markets: world.comingSoon,
              }),
        public_catalog_snapshot: () =>
          world.failing
            ? new Error("down")
            : snapshotJson(world.version, {
                properties: propertiesOf(world),
                redirects: world.redirects,
                gone: ["old-slug"],
              }),
      },
    }),
  );

const handlers = z.object({
  GET: z.custom<(ctx: { request: Request }) => unknown>((value) => typeof value === "function"),
});
const getOf = (route: { options: { server?: { handlers?: unknown } } }) =>
  handlers.parse(route.options.server?.handlers).GET;
const toResponse = (value: unknown): Response => z.instanceof(Response).parse(value);

const ARCHIVE_PATH = /^\/archive\/(city|architect|style)\/([^/]+)$/;
const html = (body: string, status = 200): Response =>
  new Response(`<!doctype html><html><body>${body}</body></html>`, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });

/** A fresh isolate: every module that keeps a memo is loaded again, and the Cache API stays what it was. */
async function boot(world: World) {
  vi.resetModules();
  const db = clientFor(world);
  const [dbModule, cache, state, flags, redirects, gone, archive, pipeline] = await Promise.all([
    import("../../src/server/lib/db"),
    import("../../src/server/public/cache"),
    import("../../src/server/public/state"),
    import("../../src/server/lib/flags"),
    import("../../src/server/public/redirects"),
    import("../../src/server/seo/gone"),
    import("../../src/server/seo/archive"),
    import("../../src/server/lib/pipeline"),
  ]);
  dbModule.setDbForTests(db);
  const routes = new Map([
    [SITEMAP, getOf((await import("../../src/routes/sitemap[.]xml")).Route)],
    [LLMS, getOf((await import("../../src/routes/llms[.]txt")).Route)],
    [LLMS_FULL, getOf((await import("../../src/routes/llms-full[.]txt")).Route)],
    [ROBOTS, getOf((await import("../../src/routes/robots[.]txt")).Route)],
  ]);

  const standIn = async (page: Request): Promise<Response> => {
    const found = ARCHIVE_PATH.exec(new URL(page.url).pathname);
    if (found === null) return html("a property page");
    const [, kind, slug] = found;
    const facet = archive.getFacet(
      await state.getCatalog(db),
      await state.getPublicState(db),
      z.enum(["city", "architect", "style"]).parse(kind),
      z.string().parse(slug),
    );
    return facet === null
      ? html("not found", 404)
      : html(`${facet.label}: ${facet.items.map((item) => item.slug).join(", ")}`);
  };
  const deps = {
    render: async (page: Request) =>
      gone.withGoneStatus(page, await standIn(page), () => state.getCatalog(dbModule.getDb())),
    redirect: (page: Request) => redirects.resolveRedirect(page, dbModule.getDb()),
    cache: (page: Request, render: () => Promise<Response>) =>
      cache.cachedResponse(page, "html", render),
    getFlags: () => flags.getFlags(dbModule.getDb()),
    report: () => Promise.resolve(),
    isApiRoute: () => false,
  };

  const ask = async (path: string, init?: RequestInit): Promise<Response> => {
    const request = new Request(`${BASE}${path}`, init);
    const route = routes.get(new URL(request.url).pathname);
    if (route !== undefined) return toResponse(await route({ request }));
    return pipeline.handle(
      request,
      { env: { MOP_ENV: "production" }, waitUntil: () => undefined },
      deps,
    );
  };
  return { db, ask };
}

type Booted = Awaited<ReturnType<typeof boot>>;

/** The body of each path, asked once. */
async function bodies(booted: Booted, paths: string[] = ALL): Promise<Record<string, string>> {
  const found: Record<string, string> = {};
  for (const path of paths) found[path] = await (await booted.ask(path)).text();
  return found;
}

const changed = (before: Record<string, string>, after: Record<string, string>): string[] =>
  Object.keys(before).filter((path) => before[path] !== after[path]);

const at = (ms: number): void => {
  vi.setSystemTime(T0 + ms);
};

let store: Map<string, Response>;

beforeEach(() => {
  store = new Map();
  vi.stubGlobal("caches", {
    default: {
      match: (key: string) => Promise.resolve(store.get(key)?.clone()),
      put: (key: string, response: Response) => {
        store.set(key, response.clone());
        return Promise.resolve();
      },
    },
  });
  vi.stubEnv("SENTRY_RELEASE", "r1");
  vi.stubEnv("CATALOG_VERSION_TTL_MS", String(TTL));
  mocks.mopEnv = "production";
  vi.useFakeTimers({ toFake: ["Date"] });
  at(0);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("a warm read", () => {
  it("costs no database call for 200 requests of each document and page while the state lifetime holds", async () => {
    vi.stubEnv("CATALOG_VERSION_TTL_MS", NEVER);
    const booted = await boot(newWorld());
    await bodies(booted);
    booted.db.reset();
    const labels = new Set<string | null>();
    for (let round = 0; round < 200; round += 1) {
      for (const path of ALL) {
        labels.add((await booted.ask(path)).headers.get("x-mop-cache"));
      }
    }
    expect(booted.db.counts).toEqual({ rpc: {}, from: {}, storage: {}, total: 0 });
    expect([...labels]).toEqual(["hit"]);
  });

  it("moves the counter by state checks only, at most one per 15 seconds, with the default lifetime", async () => {
    const booted = await boot(newWorld());
    await bodies(booted);
    booted.db.reset();
    let moment = 0;
    for (let round = 0; round < 200; round += 1) {
      for (const path of ALL) {
        moment += 100;
        at(moment);
        await booted.ask(path);
      }
    }
    const { counts } = booted.db;
    expect(moment).toBe(120_000);
    expect(counts.rpc["public_state"] ?? 0).toBeGreaterThan(0);
    expect(counts.rpc["public_state"] ?? 0).toBeLessThanOrEqual(moment / TTL);
    expect(counts.total).toBe(counts.rpc["public_state"] ?? 0);
    expect(counts.from).toEqual({});
    expect(counts.storage).toEqual({});
  });
});

describe("a catalog version bump", () => {
  it("costs one snapshot read for every document and changes the sitemap", async () => {
    const world = newWorld();
    const booted = await boot(world);
    const before = await bodies(booted);
    booted.db.reset();
    world.version = 8;
    world.slugs = ["p1", "p2", "p3", "p4"];
    at(TTL);
    const after = await bodies(booted);
    await bodies(booted);
    expect(booted.db.counts.rpc).toEqual({ public_state: 1, public_catalog_snapshot: 1 });
    expect(booted.db.counts.total).toBe(2);
    expect(before[SITEMAP]).not.toContain("/property/p4");
    expect(after[SITEMAP]).toContain("/property/p4");
    const answer = await booted.ask(SITEMAP);
    expect(answer.headers.get("x-catalog-version")).toBe("8");
    expect(answer.headers.get("x-mop-cache")).toBe("hit");
  });

  it("switching the archive_pages flag off changes the sitemap, both llms files and the archive page, and nothing else", async () => {
    const world = newWorld();
    const booted = await boot(world);
    const before = await bodies(booted);
    expect(before[SITEMAP]).toContain(ARCHIVE);
    world.version = 8;
    world.archivePages = false;
    at(TTL);
    const after = await bodies(booted);
    expect(changed(before, after)).toEqual([SITEMAP, LLMS, LLMS_FULL, ARCHIVE]);
    expect(after[SITEMAP]).not.toContain(ARCHIVE);
    expect(after[ARCHIVE]).toContain("not found");
  });

  it("adding a redirects row changes the sitemap and both llms files and nothing else", async () => {
    const world = newWorld();
    const booted = await boot(world);
    const before = await bodies(booted);
    expect(before[SITEMAP]).toContain("/property/p3<");
    world.version = 8;
    world.redirects = [{ from_path: "/property/p3", to_path: "/property/p1", status: 301 }];
    at(TTL);
    const after = await bodies(booted);
    expect(changed(before, after)).toEqual([SITEMAP, LLMS, LLMS_FULL]);
    expect(after[SITEMAP]).not.toContain("/property/p3<");
    expect(after[LLMS]).not.toContain("/property/p3)");
  });

  it("moving a market out of coming_soon_markets changes the sitemap and both llms files and nothing else", async () => {
    const world = newWorld();
    const booted = await boot(world);
    const before = await bodies(booted);
    expect(before[SITEMAP]).not.toContain("/property/ny1");
    world.version = 8;
    world.comingSoon = { california: false, "new-york": false };
    at(TTL);
    const after = await bodies(booted);
    expect(changed(before, after)).toEqual([SITEMAP, LLMS, LLMS_FULL]);
    expect(after[SITEMAP]).toContain("/property/ny1");
  });
});

describe("a database error", () => {
  it("serves the last good copy as stale while the state is held from before", async () => {
    const world = newWorld();
    const booted = await boot(world);
    const before = await bodies(booted);
    world.failing = true;
    at(TTL);
    for (const path of ALL) {
      const response = await booted.ask(path);
      expect(response.headers.get("x-mop-cache")).toBe("stale");
      expect(await response.text()).toBe(before[path]);
    }
  });

  it("serves the last good copy as stale in a new isolate that cannot read the database at all", async () => {
    const world = newWorld();
    const before = await bodies(await boot(world));
    world.failing = true;
    const booted = await boot(world);
    for (const path of DOCUMENTS) {
      const response = await booted.ask(path);
      expect(response.status).toBe(200);
      expect(response.headers.get("x-mop-cache")).toBe("stale");
      expect(await response.text()).toBe(before[path]);
    }
    const page = await booted.ask(ARCHIVE);
    expect(page.headers.get("x-mop-cache")).toBe("stale");
    expect(await page.text()).toBe(before[ARCHIVE]);
  });
});

describe("the cache key and the stored copy", () => {
  it("drops the query string, so /sitemap.xml?x=1 and /sitemap.xml share one entry", async () => {
    const booted = await boot(newWorld());
    const first = await booted.ask(SITEMAP);
    const second = await booted.ask(SITEMAP);
    const third = await booted.ask(`${SITEMAP}?x=1`);
    expect([first, second, third].map((r) => r.headers.get("x-mop-cache"))).toEqual([
      "miss",
      "hit",
      "hit",
    ]);
    expect(new Set([first, second, third].map((r) => r.headers.get("x-catalog-version")))).toEqual(
      new Set(["7"]),
    );
    expect([...store.keys()].filter((key) => key.includes("sitemap"))).toEqual([
      keyOf("doc", 7, SITEMAP),
      "https://cache.mop.internal/last-good/doc/sitemap.xml",
    ]);
    expect(booted.db.counts.rpc["public_catalog_snapshot"]).toBe(1);
  });

  it("stores the documents as kind doc and the archive and 410 pages as kind html, each under the version", async () => {
    const booted = await boot(newWorld());
    await bodies(booted);
    const versioned = [...store.keys()].filter((key) => !key.includes("last-good")).sort();
    expect(versioned).toEqual(
      [
        keyOf("doc", 7, SITEMAP),
        keyOf("doc", 7, LLMS),
        keyOf("doc", 7, LLMS_FULL),
        keyOf("doc", 7, ROBOTS),
        keyOf("html", 7, ARCHIVE),
        keyOf("html", 7, GONE),
      ].sort(),
    );
    expect(store.get(keyOf("html", 7, GONE))?.status).toBe(410);
    expect(store.get(keyOf("html", 7, ARCHIVE))?.status).toBe(200);
  });

  it("tags the documents seo, keeps the edge lifetime on the stored copy only and types the sitemap as XML", async () => {
    const booted = await boot(newWorld());
    for (const path of DOCUMENTS) {
      const miss = await booted.ask(path);
      const hit = await booted.ask(path);
      for (const response of [miss, hit]) {
        expect(response.headers.get("cache-tag")).toBe("seo");
        expect(response.headers.get("cache-control")).toBe("public, max-age=3600");
      }
      expect(store.get(keyOf("doc", 7, path))?.headers.get("cache-control")).toBe(
        "public, max-age=3600, s-maxage=3600",
      );
      expect(hit.headers.get("content-type")).toBe(
        path === SITEMAP ? "application/xml; charset=utf-8" : "text/plain; charset=utf-8",
      );
    }
  });
});

describe("robots.txt", () => {
  it("is not stored for a workers.dev host and never reaches the cache or the database", async () => {
    const booted = await boot(newWorld());
    const indexable = await booted.ask(ROBOTS);
    expect(await indexable.text()).toBe(INDEXABLE_ROBOTS);
    const keys = new Set(store.keys());
    booted.db.reset();
    const closed = await booted.ask(ROBOTS, { headers: { host: WORKERS_HOST } });
    expect(await closed.text()).toBe(CLOSED_ROBOTS);
    expect(closed.headers.get("x-mop-cache")).toBe("bypass");
    expect(new Set(store.keys())).toEqual(keys);
    expect(booted.db.counts.total).toBe(0);
  });

  it("answers the indexable body the same with and without a cookie", async () => {
    const booted = await boot(newWorld());
    const withCookie = await booted.ask(ROBOTS, { headers: { cookie: "mop_consent=1.1; a=b" } });
    const without = await booted.ask(ROBOTS);
    expect(await withCookie.text()).toBe(INDEXABLE_ROBOTS);
    expect(await without.text()).toBe(INDEXABLE_ROBOTS);
    expect(without.headers.get("x-mop-cache")).toBe("hit");
  });
});

describe("cookies", () => {
  it("no document or page of the slice sets a cookie, on a miss or on a hit, whatever the request sends", async () => {
    const booted = await boot(newWorld());
    const sent = { headers: { cookie: "mop_consent=1.1; session=abc" } };
    const seen: (string | null)[] = [];
    for (const round of [0, 1]) {
      for (const path of ALL) {
        const response = await booted.ask(path, round === 0 ? sent : undefined);
        seen.push(response.headers.get("set-cookie"));
      }
    }
    expect(seen).toHaveLength(ALL.length * 2);
    expect(seen.every((value) => value === null)).toBe(true);
  });
});
