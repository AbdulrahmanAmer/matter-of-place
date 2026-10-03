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
 * @returns {string[]} the terms of `workspace/audits/keywords.json`
 */
function loadKeywords() {
  const terms = field(JSON.parse(readFileSync(KEYWORDS_FILE, "utf8")), "terms");
  return Array.isArray(terms) ? terms.filter((term) => typeof term === "string") : [];
}

/**
 * Search Console queries of the last 28 days and the coverage of the keyword list, with the service
 * account of `GOOGLE_SA_JSON_B64`. An unset credential or an empty property is `not_measured`.
 * @param {import("./common.mjs").Context} ctx
 * @returns {Promise<import("./common.mjs").Collected>}
 */
export async function collect(ctx) {
  const saJsonB64 = ctx.env["GOOGLE_SA_JSON_B64"];
  const missing = (/** @type {string} */ reason) => ({
    gsc: notMeasured(reason),
    keywords: notMeasured(reason),
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
  if (rows.length === 0) return missing(`Search Console has no queries for ${site} in 28 days`);
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
  };
}

await runCli(import.meta.url, collect);
