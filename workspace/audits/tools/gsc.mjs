import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  REPO_ROOT,
  count,
  field,
  getJson,
  measured,
  notMeasured,
  numeric,
  recordsOf,
  runCli,
} from "./common.mjs";
import { accessToken, dateWindow } from "./google-auth.mjs";

const SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const WINDOW_DAYS = 28;
const LAG_DAYS = 3;
const TOP = 10;
const ROW_LIMIT = 5000;
const KEYWORDS_FILE = resolve(REPO_ROOT, "workspace/audits/keywords.json");

/** The queries tracked every run, exactly as Search Console writes them (lower case): the brand name, twice. */
export const BRAND_QUERIES = ["matter of place", "matter of place real estate"];

/**
 * @typedef {{ query: string, impressions: number, clicks: number, position: number | null }} QueryRow
 */

/**
 * The rows of a Search Console `searchAnalytics/query` answer grouped by query.
 * @param {unknown} json
 * @returns {QueryRow[]}
 */
export function parseGsc(json) {
  return recordsOf(field(json, "rows")).flatMap((row) => {
    const keys = /** @type {unknown[]} */ (Array.isArray(row["keys"]) ? row["keys"] : []);
    const query = keys[0];
    return typeof query === "string"
      ? [
          {
            query,
            impressions: count(row["impressions"]),
            clicks: count(row["clicks"]),
            position: numeric(row["position"]),
          },
        ]
      : [];
  });
}

/**
 * A term is covered when a query that contains it, case-folded, had at least one impression.
 * @param {QueryRow[]} rows
 * @param {string[]} keywords
 * @returns {{ covered: number, total: number, missing: string[] }}
 */
export function keywordCoverage(rows, keywords) {
  const seen = rows
    .filter((row) => row.impressions >= 1)
    .map((row) => row.query.toLocaleLowerCase("en-US"));
  const missing = keywords.filter(
    (term) => !seen.some((query) => query.includes(term.toLocaleLowerCase("en-US"))),
  );
  return { covered: keywords.length - missing.length, total: keywords.length, missing };
}

/**
 * @typedef {{ status: "ranked" | "no impressions", impressions: number, clicks: number, position?: number }} BrandNumbers
 * @typedef {BrandNumbers & { name: string, previous?: BrandNumbers | null }} BrandRow
 */

/**
 * The Search Console numbers of each tracked query. A query with no impression, or no row at all, is
 * `no impressions` with no position: a position of 0 would read as first place.
 * @param {QueryRow[]} rows
 * @returns {BrandRow[]}
 */
export function brandRows(rows) {
  return BRAND_QUERIES.map(
    /** @returns {BrandRow} */ (name) => {
      const found = rows.find((row) => row.query.trim().toLocaleLowerCase("en-US") === name);
      if (found === undefined || found.impressions < 1 || found.position === null) {
        return { name, status: "no impressions", impressions: 0, clicks: 0 };
      }
      return {
        name,
        status: "ranked",
        impressions: found.impressions,
        clicks: found.clicks,
        position: Math.round(found.position * 100) / 100,
      };
    },
  );
}

/**
 * Last run's numbers beside this run's, in the sidecar itself so that every number of the report is in it. A
 * sidecar with no brand numbers (the first run, an older one, a run that did not measure) gives `previous: null`.
 * @param {{ window_days: number, queries: BrandRow[] }} brand
 * @param {unknown} previousSidecar
 * @returns {{ window_days: number, queries: BrandRow[] }}
 */
export function withPreviousBrand(brand, previousSidecar) {
  const before = recordsOf(field(field(previousSidecar, "brand_queries"), "queries"));
  return {
    ...brand,
    queries: brand.queries.map((row) => {
      const old = before.find((item) => item["name"] === row.name);
      if (old === undefined) return { ...row, previous: null };
      const position = numeric(old["position"]);
      /** @type {BrandNumbers} */
      const numbers = {
        status: old["status"] === "ranked" ? "ranked" : "no impressions",
        impressions: count(old["impressions"]),
        clicks: count(old["clicks"]),
        ...(position === null ? {} : { position }),
      };
      return { ...row, previous: numbers };
    }),
  };
}

/**
 * @returns {string[]} the terms of `workspace/audits/keywords.json`
 */
function loadKeywords() {
  const terms = field(JSON.parse(readFileSync(KEYWORDS_FILE, "utf8")), "terms");
  return Array.isArray(terms) ? terms.filter((term) => typeof term === "string") : [];
}

/**
 * Search Console queries of the last 28 days, the coverage of the keyword list and the numbers of the two
 * brand queries, with the service account of `GOOGLE_SA_JSON_B64`. An unset credential or a refused answer is
 * `not_measured`; an answer with no rows is no impressions for the brand queries and nothing else.
 * @param {import("./common.mjs").Context} ctx
 * @returns {Promise<import("./common.mjs").Collected>}
 */
export async function collect(ctx) {
  const saJsonB64 = ctx.env["GOOGLE_SA_JSON_B64"];
  const missing = (/** @type {string} */ reason) => ({
    gsc: notMeasured(reason),
    keywords: notMeasured(reason),
    brand_queries: notMeasured(reason),
  });
  if (saJsonB64 === undefined || saJsonB64 === "") return missing("GOOGLE_SA_JSON_B64 unset");
  const auth = await accessToken({
    saJsonB64,
    scope: SCOPE,
    fetchImpl: ctx.fetchImpl,
    now: ctx.now(),
  });
  if ("reason" in auth) return missing(auth.reason);
  const site = `sc-domain:${new URL(ctx.siteUrl).hostname.replace(/^www\./, "")}`;
  const answer = await getJson(
    ctx.fetchImpl,
    `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${auth.token}`, "content-type": "application/json" },
      body: JSON.stringify({
        ...dateWindow(ctx.now(), WINDOW_DAYS, LAG_DAYS),
        dimensions: ["query"],
        rowLimit: ROW_LIMIT,
      }),
    },
  );
  if (answer.status !== 200) return missing(`Search Console ${answer.reason}`);
  const rows = parseGsc(answer.json);
  if (rows.length === 0) {
    const reason = `Search Console has no queries for ${site} in 28 days`;
    return {
      gsc: notMeasured(reason),
      keywords: notMeasured(reason),
      brand_queries: measured({ window_days: WINDOW_DAYS, queries: brandRows(rows) }),
    };
  }
  return {
    gsc: measured({
      site,
      window_days: WINDOW_DAYS,
      queries: rows.length,
      impressions: rows.reduce((sum, row) => sum + row.impressions, 0),
      clicks: rows.reduce((sum, row) => sum + row.clicks, 0),
      top: [...rows]
        .sort((a, b) => b.impressions - a.impressions)
        .slice(0, TOP)
        .map((row) => ({ query: row.query, impressions: row.impressions, clicks: row.clicks })),
    }),
    keywords: measured({ ...keywordCoverage(rows, loadKeywords()), window_days: WINDOW_DAYS }),
    brand_queries: measured({ window_days: WINDOW_DAYS, queries: brandRows(rows) }),
  };
}

await runCli(import.meta.url, collect);
