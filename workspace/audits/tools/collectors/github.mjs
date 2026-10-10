import { APP_DIR, field, getJson, parseJsonOrNull, recordsOf } from "../common.mjs";

// The `actions_minutes` line (DO-08, ruling H6) from the repository API, never the billing API (it needs a `user` scope
// this login lacks, P-048). Each run counts its wall time from `run_started_at` to `updated_at`, rounded up to whole
// minutes; billed minutes round per job, so the figure is approximate. The run list carries both times, so a month of
// runs costs one request per hundred runs, not one per run (GOTCHAS P-2700). A `created` filter returns at most 1,000
// runs however many match, so the month is read one UTC day at a time, and a day at the cap is not measured (P-2702).

const RUNS = "repos/AbdulrahmanAmer/matter-of-place/actions/runs";
const PER_PAGE = 100;
const SEARCH_CAP = 1000;
const MINUTE_MS = 60_000;

/**
 * @typedef {{ run_started_at: string, updated_at: string, status: string }} Run
 */

/**
 * Whole minutes per completed run, summed.
 * @param {Run[]} runs
 * @returns {number}
 */
export function minutesThisMonth(runs) {
  return runs
    .filter((run) => run.status === "completed")
    .reduce((sum, run) => {
      const ms = Date.parse(run.updated_at) - Date.parse(run.run_started_at);
      return Number.isFinite(ms) && ms > 0 ? sum + Math.ceil(ms / MINUTE_MS) : sum;
    }, 0);
}

/**
 * @param {unknown} value
 * @returns {Run[]}
 */
const runsOf = (value) =>
  recordsOf(value).map((run) => ({
    run_started_at: String(run["run_started_at"]),
    updated_at: String(run["updated_at"]),
    status: String(run["status"]),
  }));

/**
 * Every UTC day of the current month up to today, `YYYY-MM-DD`.
 * @param {Date} now
 * @returns {string[]}
 */
const daysThisMonth = (now) =>
  Array.from(
    { length: now.getUTCDate() },
    (_, index) => `${now.toISOString().slice(0, 7)}-${String(index + 1).padStart(2, "0")}`,
  );

/**
 * Inside Actions: the workflow's own `GITHUB_TOKEN` (`actions: read`, the step 9 fallback).
 * @param {import("../common.mjs").Context} ctx
 * @param {string} day
 * @returns {Promise<Run[] | { reason: string }>}
 */
async function runsByToken(ctx, day) {
  /** @type {Run[]} */
  const runs = [];
  for (let page = 1; page <= SEARCH_CAP / PER_PAGE; page += 1) {
    const answer = await getJson(
      ctx.fetchImpl,
      `https://api.github.com/${RUNS}?created=${day}&per_page=${String(PER_PAGE)}&page=${String(page)}`,
      {
        headers: {
          authorization: `Bearer ${ctx.env["GITHUB_TOKEN"] ?? ""}`,
          accept: "application/vnd.github+json",
        },
      },
    );
    if (answer.status !== 200) return { reason: `GitHub ${answer.reason}` };
    const found = runsOf(field(answer.json, "workflow_runs"));
    runs.push(...found);
    if (found.length < PER_PAGE) break;
  }
  return runs;
}

/**
 * On the operator's laptop: the signed-in `gh`, path without a leading slash (P-048), one JSON line per run.
 * @param {import("../common.mjs").Context} ctx
 * @param {string} day
 * @returns {Run[] | { reason: string }}
 */
function runsByGh(ctx, day) {
  const ran = ctx.run(
    "gh",
    [
      "api",
      `${RUNS}?created=${day}&per_page=${String(PER_PAGE)}`,
      "--paginate",
      "--jq",
      ".workflow_runs[] | {run_started_at, updated_at, status} | @json",
    ],
    APP_DIR,
  );
  if (ran.status !== 0) return { reason: `gh api exited ${String(ran.status)}` };
  return runsOf(
    ran.stdout
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => parseJsonOrNull(line)),
  );
}

/**
 * @param {import("../common.mjs").Context} ctx
 * @returns {Promise<import("./ours.mjs").Reading[]>}
 */
export async function collect(ctx) {
  /** @type {(day: string) => Promise<Run[] | { reason: string }>} */
  let runsOn;
  if (ctx.env["GITHUB_ACTIONS"] === "true") runsOn = (day) => runsByToken(ctx, day);
  else if (ctx.run("gh", ["auth", "status"], APP_DIR).status === 0)
    runsOn = (day) => Promise.resolve(runsByGh(ctx, day));
  else {
    return [
      {
        line: "actions_minutes",
        error: "not_measured: no Actions token and no signed-in gh",
      },
    ];
  }
  /** @type {Run[]} */
  const runs = [];
  for (const day of daysThisMonth(ctx.now())) {
    const found = await runsOn(day);
    if ("reason" in found) {
      return [{ line: "actions_minutes", error: `not_measured: ${found.reason}` }];
    }
    if (found.length >= SEARCH_CAP) {
      return [
        { line: "actions_minutes", error: `not_measured: ${day} reached the 1,000 run list cap` },
      ];
    }
    runs.push(...found);
  }
  return [
    {
      line: "actions_minutes",
      used: minutesThisMonth(runs),
      detail: { runs: runs.length },
    },
  ];
}
