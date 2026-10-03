import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { makeContext } from "../../../../workspace/audits/tools/common.mjs";
import { collect, parseBing } from "../../../../workspace/audits/tools/bing.mjs";

const NOW = new Date("2026-10-03T00:00:00Z");

function recorded(): unknown {
  return JSON.parse(
    readFileSync(
      new URL("../../../../workspace/audits/tools/fixtures/bing-query-stats.json", import.meta.url),
      "utf8",
    ),
  );
}

function context(env: Record<string, string | undefined>, answer: () => Response) {
  const urls: string[] = [];
  const ctx = makeContext({
    env,
    now: () => NOW,
    fetchImpl: (url) => {
      urls.push(url);
      return Promise.resolve(answer());
    },
  });
  return { ctx, urls };
}

describe("parseBing", () => {
  it("sums only the rows of the last 28 days", () => {
    expect(parseBing(recorded(), NOW)).toEqual({ queries: 2, impressions: 65, clicks: 3 });
  });
});

describe("bing collect", () => {
  it("makes no request and records not_measured while the key is unset", async () => {
    const { ctx, urls } = context({}, () => Response.json(recorded()));
    expect(await collect(ctx)).toEqual({ bing: { notMeasured: "BING_WEBMASTER_API_KEY unset" } });
    expect(urls).toEqual([]);
  });

  it("calls GetQueryStats once with the key and writes the sums", async () => {
    const { ctx, urls } = context({ BING_WEBMASTER_API_KEY: "bing-key-for-test" }, () =>
      Response.json(recorded()),
    );
    expect(await collect(ctx)).toEqual({
      bing: { value: { window_days: 28, queries: 2, impressions: 65, clicks: 3 } },
    });
    expect(urls).toEqual([
      "https://ssl.bing.com/webmaster/api.svc/json/GetQueryStats?siteUrl=https%3A%2F%2Fmatterofplace.com%2F&apikey=bing-key-for-test",
    ]);
  });

  it("records not_measured for an ErrorCode body and for a non-200 answer", async () => {
    const env = { BING_WEBMASTER_API_KEY: "bing-key-for-test" };
    const coded = context(env, () => Response.json({ ErrorCode: 14, Message: "InvalidApiKey" }));
    expect(await collect(coded.ctx)).toEqual({
      bing: { notMeasured: "Bing ErrorCode 14: InvalidApiKey" },
    });
    const refused = context(env, () => new Response("no", { status: 401 }));
    expect(await collect(refused.ctx)).toEqual({ bing: { notMeasured: "Bing HTTP 401" } });
    expect(refused.urls).toHaveLength(1);
  });
});
