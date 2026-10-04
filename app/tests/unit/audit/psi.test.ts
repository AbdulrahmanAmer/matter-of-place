import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { makeContext } from "../../../../workspace/audits/tools/common.mjs";
import { collect, parsePsi, pickPages } from "../../../../workspace/audits/tools/psi.mjs";

const NOW = new Date("2026-10-03T00:00:00Z");
const SITEMAP = `<urlset><url><loc>https://matterofplace.com/</loc></url>
<url><loc>https://matterofplace.com/florida</loc></url>
<url><loc>https://matterofplace.com/property/house-on-the-bluff</loc></url></urlset>`;
const PAGES = [
  "/",
  "/properties",
  "/property/house-on-the-bluff",
  "/florida",
  "/exposure",
  "/submit",
];

function recorded(): unknown {
  return JSON.parse(
    readFileSync(
      new URL("../../../../workspace/audits/tools/fixtures/psi-response.json", import.meta.url),
      "utf8",
    ),
  );
}

function context(env: Record<string, string | undefined>, handler: (url: string) => Response) {
  const urls: string[] = [];
  const sleeps: number[] = [];
  const ctx = makeContext({
    env,
    siteUrl: "https://matterofplace.com",
    now: () => NOW,
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
    fetchImpl: (url) => {
      urls.push(url);
      return Promise.resolve(handler(url));
    },
  });
  return { ctx, urls, sleeps };
}

const answer = (url: string): Response =>
  url.endsWith("/sitemap.xml") ? new Response(SITEMAP) : Response.json(recorded());

describe("parsePsi", () => {
  it("turns a recorded answer into score, LCP, CLS, INP and weight", () => {
    expect(parsePsi(recorded())).toEqual({
      score: 93,
      lcp_ms: 2141,
      cls: 0.012,
      inp_ms: 180,
      weight_bytes: 812345,
    });
  });

  it("gives null for a number the answer lacks", () => {
    expect(parsePsi({})).toEqual({
      score: null,
      lcp_ms: null,
      cls: null,
      inp_ms: null,
      weight_bytes: null,
    });
  });
});

describe("pickPages", () => {
  it("takes the four fixed pages, the first property and the first market", () => {
    expect(pickPages(SITEMAP)).toEqual(PAGES);
  });
});

describe("psi collect", () => {
  it("makes no call and records not_measured while PSI_API_KEY is unset", async () => {
    const { ctx, urls } = context({}, answer);
    expect(await collect(ctx)).toEqual({ psi: { notMeasured: "PSI_API_KEY unset" } });
    expect(urls).toEqual([]);
  });

  it("measures six pages, three runs each, on mobile", async () => {
    const { ctx, urls } = context({ PSI_API_KEY: "psi-key-for-test" }, answer);
    expect(await collect(ctx)).toEqual({
      psi: {
        value: {
          strategy: "mobile",
          failed: [],
          pages: PAGES.map((path) => ({
            path,
            runs: 3,
            score: 93,
            lcp_ms: 2141,
            cls: 0.012,
            inp_ms: 180,
            weight_bytes: 812345,
          })),
        },
      },
    });
    const psiCalls = urls.filter((url) => url.includes("runPagespeed"));
    expect(psiCalls).toHaveLength(18);
    expect(psiCalls[0]).toBe(
      "https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=https%3A%2F%2Fmatterofplace.com%2F&strategy=mobile&key=psi-key-for-test",
    );
  });

  it("retries a 429 once after 10 seconds", async () => {
    let limited = true;
    const { ctx, sleeps } = context({ PSI_API_KEY: "psi-key-for-test" }, (url) => {
      if (url.includes("runPagespeed") && limited) {
        limited = false;
        return new Response("slow down", { status: 429 });
      }
      return answer(url);
    });
    await collect(ctx);
    expect(sleeps).toEqual([10_000]);
  });

  it("records not_measured when every run fails, and does not throw", async () => {
    const { ctx } = context({ PSI_API_KEY: "psi-key-for-test" }, (url) =>
      url.endsWith("/sitemap.xml") ? new Response(SITEMAP) : new Response("down", { status: 503 }),
    );
    expect(await collect(ctx)).toEqual({ psi: { notMeasured: "no page measured: HTTP 503" } });
  });
});
