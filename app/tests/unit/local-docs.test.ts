import "../fixtures/worker-env";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { properties } from "../../src/data/properties";
import { catalogDb } from "../fixtures/snapshot";

// P-3410: after the previews lose the database (H35 (7)) the dev Worker deploys with MOP_ENV local and no Supabase
// key. The sitemap and the two llms files must then answer from the bundled catalog, as the pages do, and not 503.

const mocks = vi.hoisted(() => ({ mopEnv: "local" }));
vi.mock("../../src/server/lib/env", () => ({
  env: {
    get MOP_ENV() {
      return mocks.mopEnv;
    },
  },
}));

const handlers = z.object({
  GET: z.custom<(ctx: { request: Request }) => unknown>((value) => typeof value === "function"),
});
const getOf = (route: { options: { server?: { handlers?: unknown } } }) =>
  handlers.parse(route.options.server?.handlers).GET;

const routes = {
  "/sitemap.xml": async () => (await import("../../src/routes/sitemap[.]xml")).Route,
  "/llms.txt": async () => (await import("../../src/routes/llms[.]txt")).Route,
  "/llms-full.txt": async () => (await import("../../src/routes/llms-full[.]txt")).Route,
};

const paths = ["/sitemap.xml", "/llms.txt", "/llms-full.txt"] as const;

async function get(path: keyof typeof routes): Promise<Response> {
  const handler = getOf(await routes[path]());
  const request = new Request(`https://matter-of-place-dev.holy-meadow-4327.workers.dev${path}`);
  return z.instanceof(Response).parse(await Reflect.apply(handler, undefined, [{ request }]));
}

const firstSlug = properties[0]?.slug ?? "";

describe("the document routes on a local Worker without a database key", () => {
  beforeEach(() => {
    mocks.mopEnv = "local";
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("answers the sitemap 200 with valid XML listing the bundled catalog", async () => {
    const response = await get("/sitemap.xml");
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/xml; charset=utf-8");
    expect(body.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(body).toContain("<urlset");
    expect(body.trimEnd().endsWith("</urlset>")).toBe(true);
    expect(firstSlug).not.toBe("");
    expect(body).toContain(`/property/${firstSlug}</loc>`);
  });

  it("answers llms.txt 200 as plain text naming the bundled properties", async () => {
    const response = await get("/llms.txt");
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(body).toContain(`/property/${firstSlug}`);
  });

  it("answers llms-full.txt 200 as plain text naming the bundled properties", async () => {
    const response = await get("/llms-full.txt");
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(body).toContain(`/property/${firstSlug}`);
  });

  it("keeps the 503 in every other environment, so production never lists an illustrative property", async () => {
    mocks.mopEnv = "production";
    for (const path of paths) {
      await expect(get(path)).rejects.toMatchObject({ code: "unavailable" });
    }
  });

  it("keeps the database path when a client exists, even on a local Worker", async () => {
    const { setDbForTests } = await import("../../src/server/lib/db");
    setDbForTests(catalogDb(9));
    const body = await (await get("/sitemap.xml")).text();
    expect(body).toContain("/property/p1</loc>");
    expect(body).not.toContain(`/property/${firstSlug}</loc>`);
    setDbForTests(undefined);
  });

  it("keeps the 503 in a live build without a key, which drops the bundled catalog", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.example.test");
    await expect(get("/sitemap.xml")).rejects.toMatchObject({ code: "unavailable" });
  });
});
