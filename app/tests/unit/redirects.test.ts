import "../fixtures/worker-env";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Json } from "../../src/db";
import type { PipelineDeps } from "../../src/server/lib/pipeline";
import { fakeDb } from "../fixtures/fake-db";
import { catalogDb, propertyJson, snapshotJson, stateJson } from "../fixtures/snapshot";

const BASE = "https://matterofplace.com";
const id = z.object({ id: z.string() }).parse(propertyJson()).id;
const parts: Record<string, Json> = {
  slug_history: [{ slug: "old", property_id: id }],
  redirects: [{ from_path: "/summer", to_path: "/markets", status: 302 }],
};

async function load() {
  vi.resetModules();
  return {
    redirects: await import("../../src/server/public/redirects"),
    pipeline: await import("../../src/server/lib/pipeline"),
  };
}

const get = (path: string, init?: RequestInit) => new Request(`${BASE}${path}`, init);
const dbCalls = (db: ReturnType<typeof fakeDb>) => db.calls.length;

beforeEach(() => {
  vi.stubEnv("CATALOG_VERSION_TTL_MS", "15000");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("loadRedirectMap", () => {
  const catalog = {
    properties: [{ id: "a", slug: "current" }],
    redirects: [{ from_path: "/Summer/", to_path: "/markets", status: 302 }],
    slugHistory: [
      { slug: "old", property_id: "a" },
      { slug: "gone", property_id: "unpublished" },
      { slug: "current", property_id: "a" },
    ],
  };

  it("maps an old slug of a published property to its current one with a 301", async () => {
    const { redirects } = await load();
    const map = redirects.loadRedirectMap(catalog);
    expect(map.get("/property/old")).toEqual({ to: "/property/current", status: 301 });
  });

  it("holds nothing for a property that is not published, nor for its own current slug", async () => {
    const { redirects } = await load();
    const map = redirects.loadRedirectMap(catalog);
    expect(map.has("/property/gone")).toBe(false);
    expect(map.has("/property/current")).toBe(false);
  });

  it("holds an enabled row under its path read as the router reads it, and lets a row win over a moved slug", async () => {
    const { redirects } = await load();
    const map = redirects.loadRedirectMap({
      ...catalog,
      redirects: [
        ...catalog.redirects,
        { from_path: "/property/old", to_path: "/stories", status: 308 },
      ],
    });
    expect(map.get("/summer")).toEqual({ to: "/markets", status: 302 });
    expect(map.get("/property/old")).toEqual({ to: "/stories", status: 308 });
  });
});

describe("resolveRedirect", () => {
  it("answers a moved slug with 301, the new path and no-store, keeping the query", async () => {
    const { redirects } = await load();
    const response = await redirects.resolveRedirect(
      get("/property/old?utm_source=x"),
      catalogDb(7, parts),
    );
    expect(response?.status).toBe(301);
    expect(response?.headers.get("location")).toBe("/property/p1?utm_source=x");
    expect(response?.headers.get("cache-control")).toBe("no-store");
  });

  it("answers a table row with its stored status, however the path is cased or slashed", async () => {
    const { redirects } = await load();
    const db = catalogDb(7, parts);
    const response = await redirects.resolveRedirect(get("/Summer/"), db);
    expect([response?.status, response?.headers.get("location")]).toEqual([302, "/markets"]);
  });

  it("answers null for a path in neither source, so the page reaches its own 404", async () => {
    const { redirects } = await load();
    expect(
      await redirects.resolveRedirect(get("/property/nowhere"), catalogDb(7, parts)),
    ).toBeNull();
  });

  it("holds no redirect for a disabled row: the snapshot carries enabled rows only", async () => {
    const { redirects } = await load();
    const db = catalogDb(7, { redirects: [] });
    expect(await redirects.resolveRedirect(get("/summer"), db)).toBeNull();
  });

  it("costs no database call after the first lookup of a catalog version", async () => {
    const { redirects } = await load();
    const db = catalogDb(7, parts);
    await redirects.resolveRedirect(get("/summer"), db);
    const warm = dbCalls(db);
    for (let lookup = 0; lookup < 100; lookup += 1) {
      await redirects.resolveRedirect(get(lookup % 2 === 0 ? "/summer" : "/property/old"), db);
    }
    expect(dbCalls(db)).toBe(warm);
  });

  it("follows the catalog version: an edited row answers within the interval", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-10-01T12:00:00Z"));
      const { redirects } = await load();
      const answers = { version: 7, to: "/markets" };
      const db = fakeDb({
        rpc: {
          public_state: () => stateJson(answers.version),
          public_catalog_snapshot: () =>
            snapshotJson(answers.version, {
              redirects: [{ from_path: "/summer", to_path: answers.to, status: 302 }],
            }),
        },
      });
      expect((await redirects.resolveRedirect(get("/summer"), db))?.headers.get("location")).toBe(
        "/markets",
      );
      answers.version = 8;
      answers.to = "/stories";
      vi.setSystemTime(new Date("2026-10-01T12:00:16Z"));
      expect((await redirects.resolveRedirect(get("/summer"), db))?.headers.get("location")).toBe(
        "/stories",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("answers null, not an error, when the catalog cannot be read at all", async () => {
    const { redirects } = await load();
    const db = fakeDb({ rpc: { public_state: () => new Error("down") } });
    expect(await redirects.resolveRedirect(get("/summer"), db)).toBeNull();
  });
});

describe("handle with a redirect", () => {
  function run(path: string) {
    return load().then(({ redirects, pipeline }) => {
      const db = catalogDb(7, parts);
      const cached = vi.fn<PipelineDeps["cache"]>((_request, render) => render());
      const rendered = vi.fn<PipelineDeps["render"]>(() => Promise.resolve(new Response("<p>")));
      const lookedUp = vi.fn<PipelineDeps["redirect"]>((request) =>
        redirects.resolveRedirect(request, db),
      );
      const response = pipeline.handle(
        get(path),
        { env: { MOP_ENV: "local" }, waitUntil: () => undefined },
        {
          render: rendered,
          redirect: lookedUp,
          cache: cached,
          getFlags: () => Promise.resolve({}),
          report: () => Promise.resolve(),
          isApiRoute: () => false,
        },
      );
      return response.then((answer) => ({ answer, cached, rendered, lookedUp }));
    });
  }

  it("answers a redirected path with 301 and no-store, and never reaches the cache hook or the render", async () => {
    const { answer, cached, rendered } = await run("/property/old");
    expect(answer.status).toBe(301);
    expect(answer.headers.get("location")).toBe("/property/p1");
    expect(answer.headers.get("cache-control")).toBe("no-store");
    expect(answer.headers.get("x-request-id")).not.toBeNull();
    expect(cached).not.toHaveBeenCalled();
    expect(rendered).not.toHaveBeenCalled();
  });

  it("never looks up /api, /admin or a document, and renders them as before", async () => {
    for (const path of ["/api/public/properties", "/admin", "/robots.txt", "/media/o/p1/x"]) {
      const { lookedUp, rendered } = await run(path);
      expect(lookedUp).not.toHaveBeenCalled();
      expect(rendered).toHaveBeenCalledTimes(1);
    }
  });

  it("lets a path with no redirect through to the cache hook", async () => {
    const { answer, cached } = await run("/california");
    expect(answer.status).toBe(200);
    expect(cached).toHaveBeenCalledTimes(1);
  });
});
