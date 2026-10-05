import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { handle, type PipelineContext, type PipelineDeps } from "../../src/server/lib/pipeline";
import { buildRobots, isIndexableHost } from "../../src/server/seo/robots";

const WORKERS = "holy-meadow-4327.workers.dev";
const INDEXABLE_BODY = [
  "User-agent: *",
  "Allow: /",
  "Disallow: /admin",
  "Disallow: /api",
  "",
  "Sitemap: https://matterofplace.com/sitemap.xml",
  "",
].join("\n");
const CLOSED_BODY = "User-agent: *\nDisallow: /\n";

const mocks = vi.hoisted(() => ({
  mopEnv: "production",
  cachedResponse:
    vi.fn<(request: Request, kind: string, build: () => Promise<Response>) => Promise<Response>>(),
}));
vi.mock("../../src/server/lib/env", () => ({
  env: {
    get MOP_ENV() {
      return mocks.mopEnv;
    },
  },
}));
vi.mock("../../src/server/public/cache", () => ({ cachedResponse: mocks.cachedResponse }));

const hosts: [string, string, boolean][] = [
  ["matterofplace.com", "production", true],
  ["MatterOfPlace.com:443", "production", true],
  ["127.0.0.1:8788", "production", true],
  [`matter-of-place.${WORKERS}`, "production", false],
  [`Pr-1.${WORKERS.toUpperCase()}:443`, "production", false],
  [`pr-1.${WORKERS}`, "preview", false],
  ["matterofplace.com", "preview", false],
  ["matterofplace.com", "local", false],
  ["matterofplace.com", "", false],
];

describe("isIndexableHost", () => {
  it.each(hosts)("answers for %s under MOP_ENV %s: %s", (host, env, expected) => {
    expect(isIndexableHost(host, env)).toBe(expected);
  });
});

describe("buildRobots", () => {
  it("gives the real domain one allow block, the two disallows and the sitemap line", async () => {
    const response = buildRobots("matterofplace.com", "production");
    expect(await response.text()).toBe(INDEXABLE_BODY);
  });

  it("names no crawler but the wildcard (S44)", async () => {
    const body = await buildRobots("matterofplace.com", "production").text();
    expect(body.match(/^user-agent:/gim)).toHaveLength(1);
    expect(body).not.toMatch(/gptbot|claudebot|ccbot|google-extended|perplexity/i);
  });

  it.each([
    [`matter-of-place.${WORKERS}`, "production"],
    [`pr-1.${WORKERS}`, "preview"],
    ["127.0.0.1:8788", "local"],
  ])("closes the whole site on %s under MOP_ENV %s", async (host, env) => {
    const body = await buildRobots(host, env).text();
    expect(body).toBe(CLOSED_BODY);
    expect(body).not.toContain("Sitemap");
  });

  it("answers as plain text", () => {
    for (const host of ["matterofplace.com", `pr-1.${WORKERS}`]) {
      const response = buildRobots(host, "production");
      expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    }
  });
});

describe("X-Robots-Tag by host in the pipeline (G19)", () => {
  const run = (host: string, mopEnv: string): Promise<Response> => {
    const ctx: PipelineContext = { env: { MOP_ENV: mopEnv }, waitUntil: vi.fn() };
    const deps: PipelineDeps = {
      render: () => Promise.resolve(new Response("ok")),
      redirect: () => Promise.resolve(null),
      cache: (_request, render) => render(),
      getFlags: () => Promise.resolve({}),
      report: () => Promise.resolve(),
      isApiRoute: () => false,
    };
    return handle(
      new Request("https://matterofplace.com/robots.txt", { headers: { host } }),
      ctx,
      deps,
    );
  };

  it.each([
    [`matter-of-place.${WORKERS}`, "production", "noindex, nofollow"],
    [`pr-1.${WORKERS}`, "preview", "noindex, nofollow"],
    ["matterofplace.com", "production", null],
    ["127.0.0.1:8788", "production", null],
  ])("sets the header for %s under MOP_ENV %s to %s", async (host, mopEnv, expected) => {
    const response = await run(host, mopEnv);
    expect(response.headers.get("x-robots-tag")).toBe(expected);
  });
});

describe("the robots route", () => {
  const get = async (host: string, mopEnv: string): Promise<Response> => {
    mocks.mopEnv = mopEnv;
    const { Route } = await import("../../src/routes/robots[.]txt");
    const handler = Route.options.server?.handlers;
    if (typeof handler !== "object" || handler.GET === undefined) throw new Error("no GET handler");
    const request = new Request("https://matterofplace.com/robots.txt", { headers: { host } });
    return z.instanceof(Response).parse(await Reflect.apply(handler.GET, undefined, [{ request }]));
  };

  beforeEach(() => {
    mocks.cachedResponse.mockReset();
    mocks.cachedResponse.mockImplementation(
      async (_request, _kind, build) => new Response(await (await build()).text()),
    );
  });

  it("stores the indexable body as a doc and serves what the cache gives back", async () => {
    const response = await get("matterofplace.com", "production");
    expect(await response.text()).toBe(INDEXABLE_BODY);
    expect(mocks.cachedResponse).toHaveBeenCalledTimes(1);
    expect(mocks.cachedResponse.mock.calls[0]?.[1]).toBe("doc");
  });

  it.each([
    [`pr-1.${WORKERS}`, "preview"],
    [`matter-of-place.${WORKERS}`, "production"],
  ])("closes %s under MOP_ENV %s without touching the cache", async (host, mopEnv) => {
    const response = await get(host, mopEnv);
    expect(await response.text()).toBe(CLOSED_BODY);
    expect(response.headers.get("x-mop-cache")).toBe("bypass");
    expect(mocks.cachedResponse).not.toHaveBeenCalled();
  });
});

describe("the static file", () => {
  it("is gone, because a file in public/ would answer before the route", () => {
    expect(existsSync(fileURLToPath(new URL("../../public/robots.txt", import.meta.url)))).toBe(
      false,
    );
  });
});
