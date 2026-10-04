import { APP_DIR, PRODUCTION_HOST, getText, measured, notMeasured, runCli } from "./common.mjs";

const INDEXABILITY = /noindex|x-robots-tag|robots|sitemap/i;
const NON_PRODUCTION = "non-production host, G19";

/**
 * @typedef {{ check: string, status: "ok" | "fail" | "skip", detail: string }} CrawlRow
 */

/**
 * The lines of one of B13's checkers. They print `ok <what>` per passing check and `skip <type>` for
 * a type with nothing to check; a non-zero exit makes every other line, and the exit itself when
 * there is none, a failed check: a checker that fails is a finding source, not a crash.
 * @param {string} output
 * @param {number} status exit code
 * @param {string} tool name of the checker, for the row an exit without a line gets
 * @returns {CrawlRow[]}
 */
export function parseRows(output, status, tool) {
  /** @type {CrawlRow[]} */
  const rows = [];
  for (const line of output.split(/\r?\n/).map((text) => text.trim())) {
    const parts = /^(ok|skip|fail)\b:?\s*(.*)$/i.exec(line);
    const word = parts?.[1]?.toLowerCase();
    if (word === "ok" || word === "skip") {
      rows.push({ check: parts?.[2] ?? "", status: word, detail: "" });
    } else if (word === "fail") {
      rows.push({ check: parts?.[2] ?? "", status: "fail", detail: "" });
    } else if (status !== 0 && line !== "" && !line.startsWith("$ ")) {
      rows.push({ check: line, status: "fail", detail: "" });
    }
  }
  if (status !== 0 && !rows.some((row) => row.status === "fail")) {
    rows.push({ check: `${tool} exited ${String(status)}`, status: "fail", detail: "" });
  }
  return rows;
}

/**
 * Rows about indexability (a noindex header, robots disallow, sitemap reachability) say nothing
 * about the site on any host but the production domain: every `workers.dev` host answers noindex
 * on purpose (G19). They leave the findings and become `not_measured`.
 * @param {CrawlRow[]} rows
 * @param {string} host
 * @returns {{ rows: CrawlRow[], notMeasured: { check: string, reason: string }[] }}
 */
export function classifyCrawl(rows, host) {
  const production = host === PRODUCTION_HOST || host === `www.${PRODUCTION_HOST}`;
  if (production) return { rows, notMeasured: [] };
  const moved = rows.filter((row) => INDEXABILITY.test(row.check));
  return {
    rows: rows.filter((row) => !moved.includes(row)),
    notMeasured: moved.map((row) => ({ check: row.check, reason: NON_PRODUCTION })),
  };
}

/**
 * @param {string} line
 * @returns {string} the path of the first URL in the line, else the line
 */
function pathOf(line) {
  const url = /https?:\/\/\S+/.exec(line)?.[0];
  return url === undefined ? line : new URL(url).pathname;
}

/**
 * B13's three checkers against one base URL, from `app/`, folded into `seo` and `aeo`.
 * @param {import("./common.mjs").Context} ctx
 * @returns {Promise<import("./common.mjs").Collected>}
 */
export async function collect(ctx) {
  if (ctx.siteUrl === "") {
    const unset = notMeasured("SITE_URL unset");
    return { seo: unset, aeo: unset };
  }
  const base = ctx.siteUrl.replace(/\/+$/, "");
  const checker = (/** @type {string} */ script) => {
    const result = ctx.run("bun", ["run", `scripts/${script}.ts`, base], APP_DIR);
    return parseRows(result.stdout, result.status, script);
  };
  const seo = classifyCrawl(checker("check-seo"), new URL(base).hostname);
  const jsonld = checker("validate-jsonld");
  const llms = checker("validate-llms");
  const [llmsFile, home] = await Promise.all([
    getText(ctx.fetchImpl, `${base}/llms.txt`),
    getText(ctx.fetchImpl, `${base}/`),
  ]);
  const head = /<head[\s\S]*?<\/head>/i.exec(home.text)?.[0] ?? "";
  /** @type {import("./common.mjs").Collected} */
  const collected = {
    seo: measured({
      checks: seo.rows.filter((row) => row.status !== "skip").length,
      failed: seo.rows.filter((row) => row.status === "fail").map((row) => row.check),
    }),
    aeo: measured({
      jsonld_checked: jsonld.filter((row) => row.status === "ok").length,
      jsonld_failed: jsonld.filter((row) => row.status === "fail").map((row) => pathOf(row.check)),
      llms_present: llmsFile.status === 200,
      llms_ok: llms.every((row) => row.status !== "fail"),
      llms_linked: /llms\.txt/i.test(head),
    }),
  };
  if (seo.notMeasured.length > 0) collected["seo_indexability"] = notMeasured(NON_PRODUCTION);
  return collected;
}

await runCli(import.meta.url, collect);
