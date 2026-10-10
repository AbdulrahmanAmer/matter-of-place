import { readFileSync } from "node:fs";
import * as cloudflare from "./collectors/cloudflare.mjs";
import * as github from "./collectors/github.mjs";
import * as ours from "./collectors/ours.mjs";
import * as sentry from "./collectors/sentry.mjs";
import { field, isMain, measured, messageOf, numeric, recordsOf } from "./common.mjs";

// The `## Free-tier gauges` table (invariant 4, P-009). `limits.json` is the one place the limits and the 50, 70 and
// 90 percent thresholds are written (invariant 7). A line without a source is `Not measured`, never `ok`. The vendor
// lines (`usage`) and our own database's lines (`usage_ours`) are two sidecar keys, so `--from-data` can take the
// vendor numbers from a data branch and still read ours.

/**
 * @typedef {{ line: string, limit: number | null, unit: string, source: string, kind: "vendor" | "info" | "guideline" }} LimitLine
 * @typedef {{ watch: number, decision: number, limit: number }} Thresholds
 * @typedef {{
 *   line: string, limit: number | null, unit: string, source: string,
 *   used: number | null, percent: number | null, status: string, reason?: string,
 *   detail?: import("./common.mjs").Json,
 * }} GaugeRow
 * @typedef {(ctx: import("./common.mjs").Context) => Promise<import("./collectors/ours.mjs").Reading[]>} Collector
 */

const KINDS = /** @type {const} */ (["vendor", "info", "guideline"]);

/**
 * @param {unknown} value
 * @returns {LimitLine["kind"]}
 */
const kindOf = (value) => KINDS.find((kind) => kind === value) ?? "vendor";

/**
 * `limits.json` read field by field, so a missing number fails here and not in a status.
 * @param {unknown} json
 * @returns {{ thresholds: Thresholds, lines: LimitLine[] }}
 */
function parseLimits(json) {
  const thresholds = field(json, "thresholds");
  /** @param {string} key */
  const threshold = (key) => {
    const found = numeric(field(thresholds, key));
    if (found === null) throw new Error(`limits.json: thresholds.${key} is not a number`);
    return found;
  };
  return {
    thresholds: {
      watch: threshold("watch"),
      decision: threshold("decision"),
      limit: threshold("limit"),
    },
    lines: recordsOf(field(json, "lines")).map((line) => ({
      line: String(line["line"]),
      limit: numeric(line["limit"]),
      unit: String(line["unit"]),
      source: String(line["source"]),
      kind: kindOf(line["kind"]),
    })),
  };
}

const LIMITS = parseLimits(
  JSON.parse(readFileSync(new URL("./limits.json", import.meta.url), "utf8")),
);

/** The lines only Supabase's own usage report holds; it needs the account token the routine never has (invariant 3). */
const REPORT_ONLY = "Supabase usage report";

/**
 * A source and the lines it reads, so a source that throws marks exactly its own lines.
 * @typedef {{ lines: string[], collect: Collector }} Source
 * @type {Source[]}
 */
const VENDOR = [
  {
    lines: ["workers_requests_day", "workers_requests_month"],
    collect: cloudflare.collect,
  },
  { lines: ["sentry_errors"], collect: sentry.collect },
  { lines: ["actions_minutes"], collect: github.collect },
];

/**
 * `ok` under 50 percent, `watch` from 50, `DECISION` from 70, `LIMIT` from 90; an info line is always `info` and a
 * guideline line only `ok` or `watch` (G30, H34).
 * @param {LimitLine} line
 * @param {number} used
 * @param {Thresholds} [thresholds]
 * @returns {{ percent: number | null, status: string }}
 */
export function gaugeStatus(line, used, thresholds = LIMITS.thresholds) {
  if (line.kind === "info" || line.limit === null) return { percent: null, status: "info" };
  const percent = Math.round((used / line.limit) * 1000) / 10;
  if (line.kind === "guideline") return { percent, status: used > line.limit ? "watch" : "ok" };
  if (percent >= thresholds.limit) return { percent, status: "LIMIT" };
  if (percent >= thresholds.decision) return { percent, status: "DECISION" };
  return { percent, status: percent >= thresholds.watch ? "watch" : "ok" };
}

/**
 * @param {LimitLine} line
 * @param {string} reason
 * @returns {GaugeRow}
 */
const notMeasuredRow = (line, reason) => ({
  ...line,
  used: null,
  percent: null,
  status: "Not measured",
  reason: reason.replace(/^not_measured: /, ""),
});

/**
 * The rows of `lines`, in the order of `limits.json`, from what the collectors read.
 * @param {LimitLine[]} lines
 * @param {import("./collectors/ours.mjs").Reading[]} readings
 * @returns {GaugeRow[]}
 */
export function gaugeRows(lines, readings) {
  return lines.map((line) => {
    const reading = readings.find((candidate) => candidate.line === line.line);
    if (reading === undefined) {
      return notMeasuredRow(
        line,
        line.source === REPORT_ONLY ? "Supabase usage report needs the account token" : "no source",
      );
    }
    if ("error" in reading) return notMeasuredRow(line, reading.error);
    return {
      ...line,
      used: reading.used,
      ...gaugeStatus(line, reading.used),
      ...(reading.detail === undefined ? {} : { detail: reading.detail }),
    };
  });
}

/**
 * Runs each source; one that throws becomes an error on its lines.
 * @param {import("./common.mjs").Context} ctx
 * @param {Source[]} sources
 * @returns {Promise<import("./collectors/ours.mjs").Reading[]>}
 */
async function read(ctx, sources) {
  /** @type {import("./collectors/ours.mjs").Reading[]} */
  const readings = [];
  for (const source of sources) {
    try {
      readings.push(...(await source.collect(ctx)));
    } catch (error) {
      const reason = `not_measured: collector failed: ${messageOf(error)}`;
      readings.push(...source.lines.map((line) => ({ line, error: reason })));
    }
  }
  return readings;
}

const OUR_SOURCE = "ours.mjs";

/**
 * The vendor rows: Cloudflare, Sentry, GitHub, and the two lines of Supabase's own report.
 * @param {import("./common.mjs").Context} ctx
 * @param {Source[]} [sources]
 * @returns {Promise<GaugeRow[]>}
 */
export async function vendorRows(ctx, sources = VENDOR) {
  const lines = LIMITS.lines.filter((line) => line.source !== OUR_SOURCE);
  return gaugeRows(lines, await read(ctx, sources));
}

/**
 * Our own database's rows through `GET /api/admin/audit/usage`.
 * @param {import("./common.mjs").Context} ctx
 * @param {import("./collectors/ours.mjs").AgentTarget} [target]
 * @returns {Promise<GaugeRow[]>}
 */
export async function ourRows(ctx, target = ours.agentTarget(ctx)) {
  const lines = LIMITS.lines.filter((line) => line.source === OUR_SOURCE);
  const source = {
    lines: lines.map((line) => line.line),
    collect: (/** @type {import("./common.mjs").Context} */ c) => ours.collect(c, target),
  };
  return gaugeRows(lines, await read(ctx, [source]));
}

/**
 * The vendor lines, sidecar key `usage`.
 * @param {import("./common.mjs").Context} ctx
 * @returns {Promise<import("./common.mjs").Collected>}
 */
export const collect = async (ctx) => ({
  usage: measured(await vendorRows(ctx)),
});

/**
 * Our own lines, sidecar key `usage_ours`; `--from-data` still runs it.
 * @param {import("./common.mjs").Context} ctx
 * @returns {Promise<import("./common.mjs").Collected>}
 */
export const collectOurs = async (ctx) => ({
  usage_ours: measured(await ourRows(ctx)),
});

/**
 * The P-009 table as text, in the order of `limits.json`.
 * @param {GaugeRow[]} rows
 * @returns {string[]}
 */
export function describeRows(rows) {
  const order = LIMITS.lines.map((line) => line.line);
  return [...rows]
    .sort((a, b) => order.indexOf(a.line) - order.indexOf(b.line))
    .map((row) =>
      row.used === null
        ? `${row.line}  Not measured (${row.reason ?? ""})  source ${row.source}`
        : `${row.line}  used ${String(row.used)}  limit ${row.limit === null ? "none" : String(row.limit)}  percent ${row.percent === null ? "-" : String(row.percent)}  ${row.status}  source ${row.source}`,
    );
}

if (isMain(import.meta.url)) {
  const { ctx, target } = ours.agentCli();
  const rows = [...(await vendorRows(ctx)), ...(await ourRows(ctx, target))];
  process.stdout.write(`${describeRows(rows).join("\n")}\n`);
}
