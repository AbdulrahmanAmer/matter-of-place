import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { makeContext } from "../../../../workspace/audits/tools/common.mjs";
import { collect, describeProbe, probe } from "../../../../workspace/audits/tools/cache.mjs";

const fixtureSchema = z.object({
  base: z.string(),
  routes: z.record(z.string(), z.array(z.record(z.string(), z.string()))),
});

/** Header sets recorded per path, handed out in the order the probe asks for them. */
function serve(name: string) {
  const fixture = fixtureSchema.parse(
    JSON.parse(
      readFileSync(
        new URL(`../../../../workspace/audits/tools/fixtures/${name}.json`, import.meta.url),
        "utf8",
      ),
    ),
  );
  const requests: { url: string; headers: Headers }[] = [];
  const asked = new Map<string, number>();
  const ctx = makeContext({
    env: {},
    siteUrl: fixture.base,
    fetchImpl: (url, init) => {
      requests.push({ url, headers: new Headers(init?.headers) });
      const path = new URL(url).pathname;
      const list = fixture.routes[path] ?? [];
      const count = asked.get(path) ?? 0;
      asked.set(path, count + 1);
      const headers = list[Math.min(count, list.length - 1)] ?? {};
      return Promise.resolve(new Response(null, { status: 200, headers }));
    },
  });
  return { ctx, requests };
}

const red = (checks: { status: string; check: string }[]) =>
  checks.filter((check) => check.status === "red").map((check) => check.check);

describe("the cache probe on recorded header sets", () => {
  it("gives ratio 1 and no red row for the all-hit set", async () => {
    const { ctx } = serve("cache-all-hit");
    const result = await probe(ctx);
    expect(result.summary.edge_hit_ratio).toBe(1);
    expect(result.summary.headers_present_ratio).toBe(1);
    expect(red(result.checks)).toEqual([]);
  });

  it("gives edge_hit_ratio null and prints Not measured for the workers.dev set", async () => {
    const { ctx } = serve("cache-workers-dev");
    const result = await probe(ctx);
    expect(result.summary.edge_hit_ratio).toBeNull();
    expect(result.summary.edge_hit_reason).toBe("the Cache API does nothing on workers.dev");
    expect(describeProbe(result).join("\n")).toContain("Not measured");
    expect(red(result.checks)).toEqual([]);
  });

  it("records the probe under cache in the sidecar shape", async () => {
    const { ctx } = serve("cache-workers-dev");
    const collected = await collect(ctx);
    expect(collected["cache"]).toMatchObject({
      value: { edge_hit_ratio: null, never_cached_ok: true, stale_count: 0 },
    });
  });

  it("gives a red row for a never-cached route without no-store", async () => {
    const { ctx } = serve("cache-never-cached-missing");
    const result = await probe(ctx);
    expect(red(result.checks)).toEqual(["never_cached /api/admin/me"]);
    expect(result.summary.never_cached_ok).toBe(false);
  });

  it("gives a red row for a never-cached route answering private, no-store (G65)", async () => {
    const { ctx } = serve("cache-never-cached-merged");
    const result = await probe(ctx);
    expect(red(result.checks)).toEqual(["never_cached /api/admin/me"]);
    expect(result.checks.find((check) => check.status === "red")?.detail).toContain(
      "private, no-store",
    );
  });

  it("gives a red row for a cookie on a cached page", async () => {
    const { ctx } = serve("cache-cookie-on-cached");
    expect(red((await probe(ctx)).checks)).toEqual(["set_cookie_on_cached"]);
  });

  it("gives a red row for a catalog version that changes mid-pass", async () => {
    const { ctx } = serve("cache-version-change");
    expect(red((await probe(ctx)).checks)).toEqual(["version_stable"]);
  });

  it("gives a red row for a query variant that misses", async () => {
    const { ctx } = serve("cache-variant-miss");
    expect(red((await probe(ctx)).checks)).toEqual(["query_variant_same_key"]);
  });

  it("counts a miss on the second pass against the ratio", async () => {
    const { ctx } = serve("cache-all-hit");
    const answer = ctx.fetchImpl;
    let seen = 0;
    const result = await probe({
      ...ctx,
      fetchImpl: (url, init) => {
        seen += 1;
        return seen === 12
          ? Promise.resolve(new Response(null, { headers: { "x-mop-cache": "miss" } }))
          : answer(url, init);
      },
    });
    expect(result.summary.edge_hit_ratio).toBeLessThan(1);
  });
});

describe("reachability", () => {
  function answering(path: string, status: number) {
    const { ctx } = serve("cache-all-hit");
    const recorded = ctx.fetchImpl;
    return {
      ...ctx,
      fetchImpl: (url: string, init?: RequestInit) =>
        new URL(url).pathname === path
          ? Promise.resolve(
              new Response(null, { status, headers: { "cache-control": "no-store" } }),
            )
          : recorded(url, init),
    };
  }

  it("does not call a never-cached route answering 401 unreachable", async () => {
    const result = await probe(answering("/api/admin/me", 401));
    expect(red(result.checks)).toEqual([]);
  });

  it("gives one red row for a page read that answers 404 on all three passes", async () => {
    const result = await probe(answering("/api/public/markets", 404));
    expect(red(result.checks)).toEqual(["reachable /api/public/markets"]);
  });
});

describe("the probe's requests", () => {
  it("send no cookie, no cache-control header, and a query string only on the variant pass", async () => {
    const { ctx, requests } = serve("cache-all-hit");
    await probe(ctx);
    expect(requests).toHaveLength(9 * 3 + 3);
    expect(requests.filter((request) => request.headers.has("cookie"))).toEqual([]);
    expect(requests.filter((request) => request.headers.has("cache-control"))).toEqual([]);
    const withQuery = requests.filter((request) => request.url.includes("?"));
    expect(withQuery).toHaveLength(9);
    expect(withQuery.every((request) => /\?probe=[0-9a-f]{8}$/.test(request.url))).toBe(true);
  });
});
