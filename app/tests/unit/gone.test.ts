import "../fixtures/worker-env";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { properties } from "../../src/data/properties";
import { stories } from "../../src/data/stories";
import { getTurnstileToken } from "../../src/lib/turnstile";
import { createHttpServices } from "../../src/services/http";
import type { FetchImpl } from "../../src/services/http/client";
import { catalogDb } from "../fixtures/snapshot";

vi.mock("../../src/lib/turnstile", () => ({ getTurnstileToken: vi.fn() }));

const TAKEN_DOWN = "old-slug";
const BASE = "https://matterofplace.com";

/** A fresh module graph per test: the catalog memo lives in module state. */
async function load() {
  vi.resetModules();
  return {
    gone: await import("../../src/server/seo/gone"),
    service: await import("../../src/server/catalog/service"),
    pipeline: await import("../../src/server/public/pipeline"),
    errors: await import("../../src/server/lib/errors"),
  };
}

const served = () => catalogDb(7, { gone: [TAKEN_DOWN] });

beforeEach(() => {
  vi.stubEnv("CATALOG_VERSION_TTL_MS", "0");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("goneState", () => {
  const live = properties[0];
  if (live === undefined) throw new Error("the bundled catalog has no property");
  const story = stories[0];
  if (story === undefined) throw new Error("the bundled catalog has no story");
  const snapshot = { gone: [TAKEN_DOWN], properties: [live], stories: [story] };

  it("calls a slug in the gone list gone", async () => {
    const { gone } = await load();
    expect(gone.goneState(snapshot, "property", TAKEN_DOWN)).toBe("gone");
  });

  it("calls an unpublished draft missing: it is in neither list", async () => {
    const { gone } = await load();
    expect(gone.goneState(snapshot, "property", "a-draft")).toBe("missing");
  });

  it("calls a slug that never existed missing", async () => {
    const { gone } = await load();
    expect(gone.goneState(snapshot, "property", "never-was")).toBe("missing");
  });

  it("calls a published property live", async () => {
    const { gone } = await load();
    expect(gone.goneState(snapshot, "property", live.slug)).toBe("live");
  });

  it("never calls a story gone, even when a taken-down property had its slug", async () => {
    const { gone } = await load();
    const shared = { ...snapshot, gone: [story.slug] };
    expect(gone.goneState(shared, "story", story.slug)).toBe("live");
    expect(gone.goneState(shared, "story", TAKEN_DOWN)).toBe("missing");
  });
});

describe("withGoneStatus", () => {
  const live = properties[0];
  if (live === undefined) throw new Error("the bundled catalog has no property");
  const snapshot = { gone: [TAKEN_DOWN], properties: [live], stories: [] };

  const run = async (path: string, init: RequestInit = {}, status = 200) => {
    const { gone } = await load();
    const read = vi.fn(() => Promise.resolve(snapshot));
    const rendered = new Response("<p>page</p>", { status, headers: { "x-from": "router" } });
    const response = await gone.withGoneStatus(new Request(`${BASE}${path}`, init), rendered, read);
    return { response, read };
  };

  it("makes the rendered page of a taken-down property 410, keeps its body and headers, stores it for a minute", async () => {
    const { response } = await run(`/property/${TAKEN_DOWN}`);
    expect(response.status).toBe(410);
    expect(await response.text()).toBe("<p>page</p>");
    expect(response.headers.get("x-from")).toBe("router");
    expect(response.headers.get("cache-control")).toBe("public, s-maxage=60");
  });

  it("finds the slug the way the router does: any case, escapes decoded, a trailing slash", async () => {
    expect((await run("/Property/OLD-%53LUG/")).response.status).toBe(410);
    expect((await run("/PROPERTY/Old-Slug/")).response.status).toBe(410);
    expect((await run("/%70roperty/old-slug")).response.status).toBe(410);
  });

  it("leaves a live property, another page, a write and a page that did not render 200 as they are", async () => {
    expect((await run(`/property/${live.slug}`)).response.status).toBe(200);
    expect((await run("/properties")).response.status).toBe(200);
    expect((await run(`/property/${TAKEN_DOWN}`, { method: "POST" })).response.status).toBe(200);
    expect((await run(`/property/${TAKEN_DOWN}`, {}, 404)).response.status).toBe(404);
  });

  it("reads the snapshot only for a property page", async () => {
    expect((await run("/properties")).read).not.toHaveBeenCalled();
    expect((await run(`/property/${TAKEN_DOWN}`)).read).toHaveBeenCalledTimes(1);
  });
});

describe("getProperty over a snapshot with a taken-down slug", () => {
  it("throws AppError gone with status 410", async () => {
    const { service, errors } = await load();
    const failure = await service
      .getProperty(served(), TAKEN_DOWN)
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(errors.AppError);
    expect(failure).toMatchObject({ code: "gone", status: 410 });
  });

  it("still answers a published slug and refuses an unknown one with not_found", async () => {
    const { service } = await load();
    expect((await service.getProperty(served(), "p1")).slug).toBe("p1");
    await expect(service.getProperty(served(), "a-draft")).rejects.toMatchObject({
      code: "not_found",
      status: 404,
    });
  });
});

describe("the public route of a property", () => {
  const errorBody = z.object({
    error: z.object({ code: z.string(), requestId: z.string().optional() }),
  });

  const call = async (slug: string) => {
    const { pipeline } = await load();
    return pipeline.handlePublic(
      new Request(`${BASE}/api/public/properties/${slug}`, {
        headers: { "cf-connecting-ip": "203.0.113.9" },
      }),
      "req-12345678",
      served(),
    );
  };

  it("answers a taken-down slug 410, stored for a minute like the 404, with no request id in the body", async () => {
    const response = await call(TAKEN_DOWN);
    expect(response.status).toBe(410);
    expect(response.headers.get("cache-control")).toBe("public, s-maxage=60");
    const { error } = errorBody.parse(await response.json());
    expect(error.code).toBe("gone");
    expect(error.requestId).toBeUndefined();
  });

  it("answers a slug that is not in the snapshot 404", async () => {
    expect((await call("a-draft")).status).toBe(404);
  });
});

describe("the http catalog adapter", () => {
  const fetchImpl = vi.fn<FetchImpl>();
  const catalog = () => createHttpServices("/api/public", fetchImpl).catalog;

  beforeEach(() => {
    fetchImpl.mockReset();
    vi.mocked(getTurnstileToken).mockResolvedValue(null);
  });

  it("maps a 410 to { gone: true }", async () => {
    fetchImpl.mockResolvedValue(new Response(null, { status: 410, statusText: "Gone" }));
    expect(await catalog().getProperty(TAKEN_DOWN)).toEqual({ gone: true });
  });

  it("maps a 404 to null, as before", async () => {
    fetchImpl.mockResolvedValue(new Response(null, { status: 404, statusText: "Not Found" }));
    expect(await catalog().getProperty("a-draft")).toBeNull();
  });

  it("does not turn a 410 on a market into a result: only a property can be gone", async () => {
    fetchImpl.mockResolvedValue(new Response(null, { status: 410, statusText: "Gone" }));
    await expect(catalog().getMarket("california")).rejects.toMatchObject({
      kind: "gone",
      status: 410,
    });
  });
});
