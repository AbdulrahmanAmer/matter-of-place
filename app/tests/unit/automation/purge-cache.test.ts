import "../../fixtures/worker-env";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { getStep } from "../../../src/server/jobs/steps/index";
import { purgeBody, purgeCache, purgeUrls } from "../../../src/server/jobs/steps/purge-cache";
import { NonRetryableError, type StepContext } from "../../../src/server/jobs/types";
import { context, NOW } from "../../fixtures/asset-rows";
import { fakeDb } from "../../fixtures/fake-db";

const URL_PURGE = "https://api.cloudflare.com/client/v4/zones/zone-123/purge_cache";

interface Sent {
  url: string;
  authorization: string | null;
  contentType: string | null;
  body: unknown;
}

/** A stand-in for Cloudflare's API: records each request and answers with `answer(call number)`. */
function cloudflare(answer: (call: number) => Response): Sent[] {
  const sent: Sent[] = [];
  vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
    const headers = new Headers(init.headers);
    sent.push({
      url,
      authorization: headers.get("authorization"),
      contentType: headers.get("content-type"),
      body: typeof init.body === "string" ? JSON.parse(init.body) : null,
    });
    return Promise.resolve(answer(sent.length));
  });
  return sent;
}

const filesBody = z.object({ files: z.array(z.string()) });

const ok = () => Response.json({ success: true, errors: [] });

const ctx = (): StepContext => context(fakeDb(), "purge_cache");
const run = (scope: "catalog" | "property" | "all") =>
  purgeCache.run(ctx(), { scope, indexnow: false }, {});

beforeEach(() => {
  vi.stubEnv("CF_PURGE_TOKEN", "token-abc");
  vi.stubEnv("CF_ZONE_ID", "zone-123");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/** How a call ended when it threw: a dead job (NonRetryableError) or a plain error the backoff retries. */
async function thrown(pending: Promise<unknown>): Promise<{ dead: boolean; message: string }> {
  try {
    await pending;
  } catch (error) {
    return {
      dead: error instanceof NonRetryableError,
      message: error instanceof Error ? error.message : String(error),
    };
  }
  return { dead: false, message: "resolved" };
}

describe("purge_cache step", () => {
  it("is in the registry", () => {
    expect(getStep("purge_cache")).toBe(purgeCache);
  });

  it("purges the catalog tag with the exact URL, header and body", async () => {
    const sent = cloudflare(ok);
    expect(await run("catalog")).toEqual({ status: "done" });
    expect(sent).toEqual([
      {
        url: URL_PURGE,
        authorization: "Bearer token-abc",
        contentType: "application/json",
        body: { tags: ["catalog"] },
      },
    ]);
  });

  it("purges the same tag for property and everything for all", async () => {
    const sent = cloudflare(ok);
    await run("property");
    await run("all");
    expect(sent.map((call) => call.body)).toEqual([
      { tags: ["catalog"] },
      { purge_everything: true },
    ]);
    expect((["catalog", "property", "all"] as const).map((scope) => purgeBody(scope))).toEqual([
      { tags: ["catalog"] },
      { tags: ["catalog"] },
      { purge_everything: true },
    ]);
  });

  it("is done and skipped, with no call, while a secret is unset", async () => {
    const sent = cloudflare(ok);
    vi.stubEnv("CF_PURGE_TOKEN", "");
    expect(await run("catalog")).toEqual({ status: "done", result: { skipped: "not_configured" } });
    vi.stubEnv("CF_PURGE_TOKEN", "token-abc");
    vi.stubEnv("CF_ZONE_ID", "");
    expect(await run("catalog")).toEqual({ status: "done", result: { skipped: "not_configured" } });
    expect(sent).toEqual([]);
  });

  it("waits Retry-After seconds from the job's clock on a 429, and 60 when the header is absent", async () => {
    cloudflare((call) =>
      call === 1
        ? new Response(null, { status: 429, headers: { "retry-after": "30" } })
        : new Response(null, { status: 429 }),
    );
    expect(await run("catalog")).toEqual({
      status: "retry_at",
      at: new Date(NOW.getTime() + 30_000),
      reason: "cf_rate_limited",
    });
    expect(await run("catalog")).toMatchObject({ at: new Date(NOW.getTime() + 60_000) });
  });

  it("throws a retryable error on a 503", async () => {
    cloudflare(() => new Response(null, { status: 503 }));
    expect(await thrown(run("catalog"))).toEqual({ dead: false, message: "cloudflare_purge_503" });
  });

  it("throws a dead-job error on a 403 and on an answer that is not a success", async () => {
    cloudflare(() => new Response(null, { status: 403 }));
    expect(await thrown(run("catalog"))).toEqual({ dead: true, message: "cloudflare_purge_403" });
    cloudflare(() => Response.json({ success: false, errors: [] }));
    expect(await thrown(run("catalog"))).toEqual({
      dead: true,
      message: "cloudflare_purge_refused",
    });
  });
});

describe("purgeUrls", () => {
  const urls = (count: number) =>
    Array.from({ length: count }, (_, i) => `https://m.test/media/${String(i)}.webp`);

  it("sends the files in one call of at most 30, and 31 in two calls of 30 and 1", async () => {
    const sent = cloudflare(ok);
    expect(await purgeUrls(urls(31), ctx())).toEqual({ purged: 31 });
    expect(sent.map((call) => filesBody.parse(call.body).files.length)).toEqual([30, 1]);
    expect(sent[0]).toMatchObject({ url: URL_PURGE, authorization: "Bearer token-abc" });
  });

  it("purges nothing and says so while a secret is unset", async () => {
    const sent = cloudflare(ok);
    vi.stubEnv("CF_ZONE_ID", "");
    expect(await purgeUrls(urls(2), ctx())).toEqual({ purged: 0, skipped: "not_configured" });
    expect(sent).toEqual([]);
  });

  it("throws on a rate limit so the job's backoff retries", async () => {
    cloudflare(() => new Response(null, { status: 429 }));
    expect(await thrown(purgeUrls(urls(1), ctx()))).toEqual({
      dead: false,
      message: "cloudflare_purge_rate_limited",
    });
  });
});
