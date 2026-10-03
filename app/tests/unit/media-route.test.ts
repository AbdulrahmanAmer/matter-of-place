import "../fixtures/worker-env";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const BASE = "https://matterofplace.com";
const STORAGE = "https://project.supabase.co/storage/v1/object/public/media/";

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

function fakeStorage(answer: (url: string) => Response | Error) {
  const fetched: string[] = [];
  vi.stubGlobal("fetch", (url: string) => {
    fetched.push(url);
    const result = answer(url);
    return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
  });
  return fetched;
}

const webp = () => new Response("webp-bytes", { headers: { "content-type": "image/webp" } });
const present = (url: string) =>
  url === `${STORAGE}v/p1/1-ab12cd34/hero.webp` ? webp() : new Response("nope", { status: 404 });

async function load() {
  vi.resetModules();
  return {
    media: await import("../../src/server/public/media"),
    db: await import("../../src/server/lib/db"),
  };
}

const get = (path: string, init?: RequestInit) => new Request(`${BASE}${path}`, init);
const written: string[] = [];

beforeEach(() => {
  vi.stubEnv("SUPABASE_URL", "https://project.supabase.co");
  written.length = 0;
  vi.spyOn(console, "log").mockImplementation((line: unknown) => {
    written.push(String(line));
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("GET /media/<key>", () => {
  it("streams the file on a miss, then answers from the edge cache with no second fetch", async () => {
    const { media } = await load();
    fakeCache();
    const fetched = fakeStorage(present);
    const first = await media.serveMedia(get("/media/v/p1/1-ab12cd34/hero.webp"), "req-12345678");
    expect(first.status).toBe(200);
    expect(first.headers.get("x-mop-cache")).toBe("miss");
    expect(first.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(first.headers.get("content-type")).toBe("image/webp");
    expect(first.headers.get("content-length")).toBe("10");
    expect(await first.text()).toBe("webp-bytes");
    const second = await media.serveMedia(get("/media/v/p1/1-ab12cd34/hero.webp"), "req-12345679");
    const third = await media.serveMedia(
      get("/media/v/p1/1-ab12cd34/hero.webp?v=2"),
      "req-1234567a",
    );
    expect(second.headers.get("x-mop-cache")).toBe("hit");
    expect(third.headers.get("x-mop-cache")).toBe("hit");
    expect(fetched).toHaveLength(1);
  });

  it("answers 404 not_found for a missing key twice, stores nothing and fetches twice", async () => {
    const { media } = await load();
    const store = fakeCache();
    const fetched = fakeStorage(present);
    const first = await media.serveMedia(get("/media/o/none/0-00000000.webp"), "req-12345678");
    const second = await media.serveMedia(get("/media/o/none/0-00000000.webp"), "req-12345679");
    expect([first.status, second.status]).toEqual([404, 404]);
    expect(first.headers.get("cache-control")).toBe("no-store");
    const body = z.object({ error: z.object({ code: z.string(), requestId: z.string() }) });
    expect(body.parse(await first.json()).error).toEqual({
      code: "not_found",
      requestId: "req-12345678",
    });
    expect(store.size).toBe(0);
    expect(fetched).toHaveLength(2);
  });

  it("reads Storage's 400 with a 404 in its body as a missing file, and any other 400 as an outage", async () => {
    const { media } = await load();
    fakeCache();
    const missing = JSON.stringify({
      statusCode: "404",
      error: "not_found",
      message: "Object not found",
    });
    fakeStorage(
      () => new Response(missing, { status: 400, headers: { "content-type": "application/json" } }),
    );
    const gone = await media.serveMedia(get("/media/o/p1/0-aaaaaaaa.webp"), "req-12345678");
    expect(gone.status).toBe(404);
    expect(gone.headers.get("cache-control")).toBe("no-store");
    fakeStorage(() => new Response(JSON.stringify({ statusCode: "400" }), { status: 400 }));
    const refused = await media.serveMedia(get("/media/o/p1/0-aaaaaaaa.webp"), "req-12345679");
    expect(refused.status).toBe(503);
    fakeStorage(() => new Response("not json", { status: 400 }));
    expect(
      (await media.serveMedia(get("/media/o/p1/0-aaaaaaaa.webp"), "req-1234567a")).status,
    ).toBe(503);
  });

  it("answers 503 storage_unavailable when Storage fails or does not answer", async () => {
    const { media } = await load();
    fakeCache();
    fakeStorage(() => new Response("boom", { status: 500 }));
    const failed = await media.serveMedia(get("/media/o/p1/0-aaaaaaaa.webp"), "req-12345678");
    expect(failed.status).toBe(503);
    expect(failed.headers.get("cache-control")).toBe("no-store");
    expect(
      z.object({ error: z.object({ code: z.string() }) }).parse(await failed.json()).error.code,
    ).toBe("storage_unavailable");
    fakeStorage(() => new Error("network"));
    const down = await media.serveMedia(get("/media/o/p1/0-aaaaaaaa.webp"), "req-12345679");
    expect(down.status).toBe(503);
  });

  it.each([
    "/media/a%2f..%2fb",
    "/media/",
    "/media/%2fo%2fx",
    "/media/-bad",
    "/media/a%00b",
    "/other/abcdefghij",
  ])("answers 404 for %s without a fetch", async (path) => {
    const { media } = await load();
    const fetched = fakeStorage(present);
    const response = await media.serveMedia(get(path), "req-12345678");
    expect(response.status).toBe(404);
    expect(fetched).toEqual([]);
  });

  it("answers 405 with Allow for any method but GET and HEAD, and fetches nothing", async () => {
    const { media } = await load();
    const fetched = fakeStorage(present);
    const response = await media.serveMedia(
      get("/media/v/p1/1-ab12cd34/hero.webp", { method: "POST" }),
      "req-12345678",
    );
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, HEAD");
    expect(fetched).toEqual([]);
  });

  it("declares ANY on the route file, so a method with no handler never renders the page shell (G-022)", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../../src/routes/media.$.ts", import.meta.url)),
      "utf8",
    );
    expect(source).toContain("handlers: { ANY: ({ request, context }) => serveMedia(");
  });

  it("answers HEAD with the same headers and no body", async () => {
    const { media } = await load();
    fakeCache();
    fakeStorage(present);
    const response = await media.serveMedia(
      get("/media/v/p1/1-ab12cd34/hero.webp", { method: "HEAD" }),
      "req-12345678",
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(await response.text()).toBe("");
  });

  it("makes no database call and writes one request line with route /media", async () => {
    const { media, db } = await load();
    fakeCache();
    fakeStorage(present);
    const before = db.dbCallCount();
    const response = await media.serveMedia(
      get("/media/v/p1/1-ab12cd34/hero.webp"),
      "req-12345678",
    );
    expect(db.dbCallCount()).toBe(before);
    expect(response.headers.get("x-request-id")).toBe("req-12345678");
    const line = z.record(z.string(), z.unknown()).parse(JSON.parse(written[0] ?? "{}"));
    expect(written).toHaveLength(1);
    expect(Object.keys(line).sort()).toEqual(
      ["event", "ipHash", "level", "ms", "requestId", "route", "status"].sort(),
    );
    expect(line).toMatchObject({ event: "request", route: "/media", status: 200 });
  });
});
