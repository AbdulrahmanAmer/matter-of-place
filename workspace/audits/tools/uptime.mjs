import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  REPO_ROOT,
  contextFromArgs,
  count,
  field,
  getJson,
  isMain,
  measured,
  notMeasured,
  numeric,
  recordsOf,
} from "./common.mjs";

const ENDPOINT = "https://api.uptimerobot.com/v2/getMonitors";
const EXPECTED_FILE = resolve(REPO_ROOT, "workspace/audits/monitoring/uptime.json");
const OPS_HEALTH = "/api/hooks/ops-health/";
const KEYWORD_MONITOR = 2;
const ALERT_WHEN_MISSING = 2;
const PAUSED = 0;
const EXPECTED_COUNT = 3;

/**
 * @typedef {{
 *   url: string,
 *   interval_s: number | null,
 *   status: number | null,
 *   uptime_30d: number | null,
 *   type: number | null,
 *   keyword_type: number | null,
 *   keyword_value: string | null,
 * }} Monitor
 * @typedef {{ name: string, url: string, interval_s: number, keyword?: string }} Expected
 * @typedef {{ check: string, status: "ok" | "red", detail: string }} UptimeRow
 */

/**
 * The ops-health token is a path segment and a secret (DO-03): it is never written anywhere.
 * @param {string} url
 * @returns {string}
 */
export const redactUrl = (url) => url.replace(/(\/ops-health\/)[^/?#\s]+/, "$1<redacted>");

/**
 * The monitors of a `getMonitors` answer in the shape the report reads.
 * @param {unknown} json
 * @returns {Monitor[]}
 */
export function parseUptime(json) {
  return recordsOf(field(json, "monitors")).map((monitor) => ({
    url: redactUrl(String(monitor["url"])),
    interval_s: numeric(monitor["interval"]),
    status: numeric(monitor["status"]),
    uptime_30d: numeric(monitor["custom_uptime_ratio"]),
    type: numeric(monitor["type"]),
    keyword_type: numeric(monitor["keyword_type"]),
    keyword_value: typeof monitor["keyword_value"] === "string" ? monitor["keyword_value"] : null,
  }));
}

/**
 * @param {string} url
 * @returns {string}
 */
const pathOf = (url) => new URL(url).pathname;

/**
 * Each expected monitor must exist, run, check at most every `interval_s` seconds and, for the
 * ops-health hook, be a keyword monitor that alerts when `ok` is missing from the body (DO-03).
 * @param {Monitor[]} monitors
 * @param {Expected[]} expected
 * @returns {UptimeRow[]}
 */
export function monitorRows(monitors, expected) {
  return expected.map((want) => {
    const path = pathOf(want.url);
    const found = monitors.find((monitor) =>
      path.startsWith(OPS_HEALTH)
        ? pathOf(monitor.url).startsWith(OPS_HEALTH)
        : pathOf(monitor.url) === path,
    );
    /** @type {(status: "ok" | "red", detail: string) => UptimeRow} */
    const row = (status, detail) => ({ check: want.name, status, detail });
    if (found === undefined) return row("red", `no monitor for ${redactUrl(path)}`);
    if (found.status === PAUSED) return row("red", "monitor is paused");
    if ((found.interval_s ?? Infinity) > want.interval_s) {
      return row(
        "red",
        `interval ${String(found.interval_s)} s, expected at most ${String(want.interval_s)} s`,
      );
    }
    if (
      want.keyword !== undefined &&
      !(
        found.type === KEYWORD_MONITOR &&
        found.keyword_value === want.keyword &&
        found.keyword_type === ALERT_WHEN_MISSING
      )
    ) {
      return row("red", `not a keyword monitor that alerts when "${want.keyword}" is missing`);
    }
    return row("ok", `30 day uptime ${String(found.uptime_30d)}`);
  });
}

/**
 * @returns {Expected[]} the three monitors of `monitoring/uptime.json`
 */
export function loadExpected() {
  return recordsOf(field(JSON.parse(readFileSync(EXPECTED_FILE, "utf8")), "monitors")).map(
    (monitor) => ({
      name: String(monitor["name"]),
      url: String(monitor["url"]),
      interval_s: count(monitor["interval_s"]),
      ...(typeof monitor["keyword"] === "string" ? { keyword: monitor["keyword"] } : {}),
    }),
  );
}

/**
 * The monitor list from the vendor's read-only API. An unset key makes no call; a non-200 answer or
 * `stat: "fail"` is `not_measured`, never a throw.
 * @param {import("./common.mjs").Context} ctx
 * @returns {Promise<import("./common.mjs").Collected>}
 */
export async function collect(ctx) {
  const key = ctx.env["UPTIME_API_KEY"];
  if (key === undefined || key === "") return { uptime: notMeasured("UPTIME_API_KEY unset") };
  const answer = await getJson(ctx.fetchImpl, ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      api_key: key,
      format: "json",
      custom_uptime_ratios: "30",
    }).toString(),
  });
  if (answer.status !== 200) return { uptime: notMeasured(`uptime monitor ${answer.reason}`) };
  if (field(answer.json, "stat") !== "ok") {
    return {
      uptime: notMeasured(`uptime monitor answered stat ${String(field(answer.json, "stat"))}`),
    };
  }
  const monitors = parseUptime(answer.json);
  const expected = loadExpected();
  /** @type {UptimeRow[]} */
  const rows = [
    ...(expected.length === EXPECTED_COUNT
      ? []
      : [
          {
            check: "uptime.json",
            status: /** @type {const} */ ("red"),
            detail: `holds ${String(expected.length)} monitors, expected ${String(EXPECTED_COUNT)}`,
          },
        ]),
    ...monitorRows(monitors, expected),
  ];
  return { uptime: measured({ monitors, rows }) };
}

/**
 * `--check-config`: one line per expected monitor, and exit code 1 when the key is unset, the
 * answer is not measured or any row is red.
 * @param {import("./common.mjs").Context} ctx
 * @returns {Promise<{ code: number, lines: string[] }>}
 */
export async function checkConfig(ctx) {
  const outcome = (await collect(ctx))["uptime"];
  if (outcome === undefined || "notMeasured" in outcome) {
    return { code: 1, lines: [`Not measured: uptime (${outcome?.notMeasured ?? "no result"})`] };
  }
  const rows = recordsOf(field(outcome.value, "rows"));
  return {
    code: rows.some((row) => row["status"] === "red") ? 1 : 0,
    lines: rows.map(
      (row) => `${String(row["status"])}  ${String(row["check"])}  ${String(row["detail"])}`,
    ),
  };
}

if (isMain(import.meta.url)) {
  const { code, lines } = await checkConfig(contextFromArgs());
  process.stdout.write(`${lines.join("\n")}\n`);
  process.exitCode = process.argv.includes("--check-config") ? code : 0;
}
