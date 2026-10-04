import {
  field,
  getJson,
  getText,
  measured,
  notMeasured,
  numeric,
  recordsOf,
  runCli,
} from "./common.mjs";

const ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";
const RUNS = 3;
const RETRY_AFTER_MS = 10_000;
const PSI_TIMEOUT_MS = 120_000;
const MARKETS = ["/california", "/new-york", "/florida"];

/**
 * @typedef {{
 *   score: number | null,
 *   lcp_ms: number | null,
 *   cls: number | null,
 *   inp_ms: number | null,
 *   weight_bytes: number | null,
 * }} PsiRun
 */

/**
 * One PageSpeed Insights answer reduced to the numbers the scorecard holds. INP is the lab audit
 * when the run has one and the field p75 of the page otherwise; a number the answer lacks is null.
 * @param {unknown} json
 * @returns {PsiRun}
 */
export function parsePsi(json) {
  const lighthouse = field(json, "lighthouseResult");
  const audit = (/** @type {string} */ id) => field(field(lighthouse, "audits"), id);
  const score = numeric(field(field(field(lighthouse, "categories"), "performance"), "score"));
  const inp =
    numeric(field(audit("interaction-to-next-paint"), "numericValue")) ??
    numeric(
      field(
        field(field(field(json, "loadingExperience"), "metrics"), "INTERACTION_TO_NEXT_PAINT"),
        "percentile",
      ),
    );
  return {
    score: score === null ? null : Math.round(score * 100),
    lcp_ms: round(numeric(field(audit("largest-contentful-paint"), "numericValue")), 0),
    cls: round(numeric(field(audit("cumulative-layout-shift"), "numericValue")), 3),
    inp_ms: round(inp, 0),
    weight_bytes: round(numeric(field(audit("total-byte-weight"), "numericValue")), 0),
  };
}

/**
 * @param {number | null} value
 * @param {number} places
 * @returns {number | null}
 */
function round(value, places) {
  return value === null ? null : Number(value.toFixed(places));
}

/**
 * @param {(number | null)[]} values
 * @returns {number | null} the middle value of the runs that have one
 */
function median(values) {
  const sorted = values.filter((value) => value !== null).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  const odd = sorted[middle];
  const below = sorted[middle - 1];
  if (sorted.length % 2 === 1 || below === undefined) return odd ?? null;
  return odd === undefined ? null : (odd + below) / 2;
}

/**
 * The six pages of the scorecard: the four fixed ones, the first property and the first market the sitemap lists.
 * @param {string} sitemapXml
 * @returns {string[]} paths
 */
export function pickPages(sitemapXml) {
  const paths = [...sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)].flatMap((match) =>
    match[1] === undefined ? [] : [new URL(match[1]).pathname],
  );
  const property = paths.find((path) => path.startsWith("/property/"));
  const market = MARKETS.find((path) => paths.includes(path));
  return [
    "/",
    "/properties",
    ...(property === undefined ? [] : [property]),
    ...(market === undefined ? [] : [market]),
    "/exposure",
    "/submit",
  ];
}

/**
 * @param {import("./common.mjs").Context} ctx
 * @param {string} key
 * @param {string} page full URL of the page
 * @returns {Promise<{ run: PsiRun } | { reason: string }>}
 */
async function runOnce(ctx, key, page) {
  const url = `${ENDPOINT}?${new URLSearchParams({ url: page, strategy: "mobile", key }).toString()}`;
  let answer = await getJson(ctx.fetchImpl, url, {}, PSI_TIMEOUT_MS);
  if (answer.status === 429 || answer.status >= 500) {
    await ctx.sleep(RETRY_AFTER_MS);
    answer = await getJson(ctx.fetchImpl, url, {}, PSI_TIMEOUT_MS);
  }
  return answer.status === 200 ? { run: parsePsi(answer.json) } : { reason: answer.reason };
}

/**
 * PageSpeed Insights for the key pages, mobile, the median of three runs each. Without `PSI_API_KEY`
 * it makes no call.
 * @param {import("./common.mjs").Context} ctx
 * @returns {Promise<import("./common.mjs").Collected>}
 */
export async function collect(ctx) {
  const key = ctx.env["PSI_API_KEY"];
  if (key === undefined || key === "") return { psi: notMeasured("PSI_API_KEY unset") };
  const base = ctx.siteUrl.replace(/\/+$/, "");
  const sitemap = (await getText(ctx.fetchImpl, `${base}/sitemap.xml`)).text;
  /** @type {import("./common.mjs").Json[]} */
  const pages = [];
  /** @type {import("./common.mjs").Json[]} */
  const failed = [];
  let firstReason = "";
  for (const path of pickPages(sitemap)) {
    /** @type {PsiRun[]} */
    const runs = [];
    let reason = "";
    for (let attempt = 0; attempt < RUNS; attempt += 1) {
      const result = await runOnce(ctx, key, `${base}${path}`);
      if ("run" in result) runs.push(result.run);
      else reason = result.reason;
    }
    if (runs.length === 0) {
      failed.push({ path, reason });
      if (firstReason === "") firstReason = reason;
    } else {
      pages.push({
        path,
        runs: runs.length,
        score: median(runs.map((run) => run.score)),
        lcp_ms: median(runs.map((run) => run.lcp_ms)),
        cls: median(runs.map((run) => run.cls)),
        inp_ms: median(runs.map((run) => run.inp_ms)),
        weight_bytes: median(runs.map((run) => run.weight_bytes)),
      });
    }
  }
  if (pages.length === 0) {
    return { psi: notMeasured(`no page measured: ${firstReason}`) };
  }
  return { psi: measured({ strategy: "mobile", pages, failed }) };
}

/**
 * @param {import("./common.mjs").Collected} collected
 * @returns {string[]}
 */
function describe(collected) {
  const outcome = collected["psi"];
  if (outcome === undefined || "notMeasured" in outcome) {
    return [`Not measured: psi (${outcome === undefined ? "no result" : outcome.notMeasured})`];
  }
  return recordsOf(field(outcome.value, "pages")).map(
    (page) =>
      `${String(page["path"])}  score ${String(page["score"])}  LCP ${String(page["lcp_ms"])} ms  CLS ${String(page["cls"])}  INP ${String(page["inp_ms"])} ms`,
  );
}

await runCli(import.meta.url, collect, describe);
