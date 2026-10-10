import { APP_DIR, field, getJson, parseJsonOrNull, recordsOf } from "../common.mjs";

// The `actions_minutes` line (DO-08, ruling H6) from the repository API, never the billing API (it needs a `user` scope
// this login lacks, P-048). Each run counts its wall time from `run_started_at` to `updated_at`, rounded up to whole
// minutes; billed minutes round per job, so the figure is approximate. The run list carries both times, so a month of
// runs costs one request per hundred runs, not one per run (GOTCHAS P-2700).

const RUNS = "repos/AbdulrahmanAmer/matter-of-place/actions/runs";
const PER_PAGE = 100;
const MAX_PAGES = 50;
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
 * The first day of the current UTC month, `YYYY-MM-01`.
 * @param {Date} now
 */
const monthStart = (now) => `${now.toISOString().slice(0, 7)}-01`;

/**
 * Inside Actions: the workflow's own `GITHUB_TOKEN` (`actions: read`, the step 9 fallback).
 * @param {import("../common.mjs").Context} ctx
 * @param {string} since
 * @returns {Promise<Run[] | { reason: string }>}
 */
async function runsByToken(ctx, since) {
  /** @type {Run[]} */
  const runs = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const answer = await getJson(
      ctx.fetchImpl,
      `https://api.github.com/${RUNS}?created=${encodeURIComponent(`>=${since}`)}&per_page=${String(PER_PAGE)}&page=${String(page)}`,
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
 * @param {string} since
 * @returns {Run[] | { reason: string }}
 */
function runsByGh(ctx, since) {
  const ran = ctx.run(
    "gh",
    [
      "api",
      `${RUNS}?created=>=${since}&per_page=${String(PER_PAGE)}`,
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
  const since = monthStart(ctx.now());
  let runs;
  if (ctx.env["GITHUB_ACTIONS"] === "true") runs = await runsByToken(ctx, since);
  else if (ctx.run("gh", ["auth", "status"], APP_DIR).status === 0) runs = runsByGh(ctx, since);
  else {
    return [
      {
        line: "actions_minutes",
        error: "not_measured: no Actions token and no signed-in gh",
      },
    ];
  }
  if ("reason" in runs) return [{ line: "actions_minutes", error: `not_measured: ${runs.reason}` }];
  return [
    {
      line: "actions_minutes",
      used: minutesThisMonth(runs),
      detail: { runs: runs.length },
    },
  ];
}
