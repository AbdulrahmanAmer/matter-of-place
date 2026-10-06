import "../fixtures/worker-env";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { purgeCache } from "../../src/server/jobs/steps/purge-cache";
import type { JsonObject, StepContext } from "../../src/server/jobs/types";
import { context } from "../fixtures/asset-rows";
import { fakeDb } from "../fixtures/fake-db";

const CLOUDFLARE = "https://api.cloudflare.com/client/v4/zones/zone-123/purge_cache";
const INDEXNOW = "https://api.indexnow.org/indexnow";
const KEY = "0123456789abcdef0123456789abcdef";

interface Call {
  method: string;
  url: string;
  authorization: string | null;
  body: unknown;
}

/** A stand-in for Cloudflare and IndexNow: records every request; `indexnow` answers the ping. */
function outside(indexnow: () => Response | Promise<Response>, cloudflare = () => ok()): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", (url: string, init: RequestInit = {}) => {
    calls.push({
      method: init.method ?? "GET",
      url,
      authorization: new Headers(init.headers).get("authorization"),
      body: typeof init.body === "string" ? JSON.parse(init.body) : null,
    });
    return Promise.resolve(url.startsWith(INDEXNOW) ? indexnow() : cloudflare());
  });
  return calls;
}

const ok = () => Response.json({ success: true, errors: [] });
const accepted = () => new Response(null, { status: 202 });

const log = vi.fn<StepContext["log"]>();
const ctx = (): StepContext => ({ ...context(fakeDb(), "purge_cache"), log });
const run = (params: Record<string, unknown>, data: JsonObject = { slug: "cliff-house" }) =>
  purgeCache.run(ctx(), params, data);

const pings = (calls: Call[]) => calls.filter((call) => call.url.startsWith(INDEXNOW));

beforeEach(() => {
  vi.stubEnv("CF_PURGE_TOKEN", "token-abc");
  vi.stubEnv("CF_ZONE_ID", "zone-123");
  vi.stubEnv("INDEXNOW_KEY", KEY);
  log.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("purge_cache, the seo tag", () => {
  it("sends the catalog and seo tags to the zone with the purge token as a bearer", async () => {
    const calls = outside(accepted);
    expect(await run({ scope: "catalog" })).toEqual({ status: "done" });
    expect(calls).toEqual([
      {
        method: "POST",
        url: CLOUDFLARE,
        authorization: "Bearer token-abc",
        body: { tags: ["catalog", "seo"] },
      },
    ]);
  });
});

describe("purge_cache, the IndexNow ping", () => {
  it("makes exactly one GET with the encoded property address and the key, after the purge", async () => {
    const calls = outside(accepted);
    expect(await run({ scope: "property", indexnow: true })).toEqual({ status: "done" });
    expect(calls.map((call) => call.method)).toEqual(["POST", "GET"]);
    expect(calls[0]?.url).toBe(CLOUDFLARE);
    const [ping] = pings(calls);
    expect(ping?.method).toBe("GET");
    expect(ping?.url).toBe(
      `${INDEXNOW}?url=https%3A%2F%2Fmatterofplace.com%2Fproperty%2Fcliff-house&key=${KEY}`,
    );
  });

  it("makes none when the step does not ask for it", async () => {
    const calls = outside(accepted);
    await run({ scope: "property" });
    await run({ scope: "property", indexnow: false });
    expect(pings(calls)).toEqual([]);
    expect(calls).toHaveLength(2);
  });

  it("leaves the step done, and logs the status, when IndexNow answers 500", async () => {
    const calls = outside(() => new Response(null, { status: 500 }));
    expect(await run({ scope: "property", indexnow: true })).toEqual({ status: "done" });
    expect(pings(calls)).toHaveLength(1);
    expect(log).toHaveBeenCalledWith("warn", "indexnow_failed", { status: 500 });
  });

  it("leaves the step done when IndexNow cannot be reached", async () => {
    outside(() => Promise.reject(new TypeError("network down")));
    expect(await run({ scope: "property", indexnow: true })).toEqual({ status: "done" });
    expect(log).toHaveBeenCalledWith("warn", "indexnow_failed", { reason: "unreachable" });
  });

  it("pings nothing, and logs it, without the key or without a slug", async () => {
    vi.stubEnv("INDEXNOW_KEY", "");
    const calls = outside(accepted);
    expect(await run({ scope: "property", indexnow: true })).toEqual({ status: "done" });
    expect(log).toHaveBeenCalledWith("info", "indexnow_skipped", { reason: "no_key" });
    vi.stubEnv("INDEXNOW_KEY", KEY);
    expect(await run({ scope: "property", indexnow: true }, {})).toEqual({ status: "done" });
    expect(log).toHaveBeenCalledWith("info", "indexnow_skipped", { reason: "no_slug" });
    expect(pings(calls)).toEqual([]);
  });

  it("makes no call at all while a purge secret is unset", async () => {
    vi.stubEnv("CF_PURGE_TOKEN", "");
    const calls = outside(accepted);
    expect(await run({ scope: "property", indexnow: true })).toEqual({
      status: "done",
      result: { skipped: "not_configured" },
    });
    expect(calls).toEqual([]);
  });

  it("does not ping while the purge waits for a rate limit", async () => {
    const calls = outside(
      accepted,
      () => new Response(null, { status: 429, headers: { "retry-after": "30" } }),
    );
    expect(await run({ scope: "property", indexnow: true })).toMatchObject({ status: "retry_at" });
    expect(pings(calls)).toEqual([]);
  });
});
