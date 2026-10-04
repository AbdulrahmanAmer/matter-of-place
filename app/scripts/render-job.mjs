// The `render` job of render.yml (B8 step 7): reads the job JSON from `MOP_JOB`, refuses a job it must not run, runs
// the work its type names and writes the outcome to `$RUNNER_TEMP/result.json`, which `post-callback.mjs` signs and
// posts. `render_reel` never reaches it: B12's `reel` job runs `scripts/render-reel.mjs`, which reuses `checkJob`.
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

const ENVS = ["preview", "production"];
const SITE_HOST = "matterofplace.com";
const WORKERS_HOST_SUFFIX = ".holy-meadow-4327.workers.dev";
const INLINE = "inline";

/**
 * @typedef {{ job_id: string, claim: string, type: string, payload: { params?: unknown, data?: unknown },
 *   env: string, callback_url: string }} RenderJob
 * @typedef {{ status: "done", result?: unknown }
 *   | { status: "failed", error: string, retryable: boolean }} RenderOutcome
 */

/**
 * An error no retry can fix: the hook calls `fail_job` with `p_dead` and the job is not dispatched again.
 * @param {string} message
 * @returns {Error}
 */
function final(message) {
  return Object.assign(new Error(message), { retryable: false });
}

/**
 * Whether a callback may go to this address: the site, or a Worker of this account (B8 Contract).
 * @param {unknown} value
 * @returns {boolean}
 */
export function callbackAllowed(value) {
  if (typeof value !== "string" || !URL.canParse(value)) return false;
  const url = new URL(value);
  return (
    url.protocol === "https:" &&
    (url.hostname === SITE_HOST || url.hostname.endsWith(WORKERS_HOST_SUFFIX))
  );
}

/**
 * The job, or a thrown non-retryable error naming why it is refused (ruling H35 (8)).
 * @param {unknown} job
 * @returns {RenderJob}
 */
export function checkJob(job) {
  if (typeof job !== "object" || job === null) throw final("job_unreadable");
  const { job_id, claim, type, payload, env, callback_url } =
    /** @type {Record<string, unknown>} */ (job);
  if (
    typeof job_id !== "string" ||
    typeof claim !== "string" ||
    typeof type !== "string" ||
    typeof payload !== "object" ||
    payload === null
  ) {
    throw final("job_unreadable");
  }
  if (typeof env !== "string" || !ENVS.includes(env)) throw final("env_refused");
  if (typeof callback_url !== "string" || !callbackAllowed(callback_url)) {
    throw final("callback_refused");
  }
  return { job_id, claim, type, payload, env, callback_url };
}

/**
 * `inline` for the heavy self-test, the B9 script path (relative to the app folder) for a `render_*` type, null for
 * any other type.
 * @param {string} type
 * @returns {string | null}
 */
export function scriptFor(type) {
  if (type === "test.selftest_heavy") return INLINE;
  if (!type.startsWith("render_")) return null;
  return `scripts/render-${type.slice("render_".length).replaceAll("_", "-")}.mjs`;
}

/**
 * The outcome of one `run`: its value is the result; a throw is retryable unless the error says otherwise.
 * @param {(job: unknown) => Promise<unknown>} run
 * @param {unknown} job
 * @returns {Promise<RenderOutcome>}
 */
export async function settleRun(run, job) {
  try {
    return { status: "done", result: await run(job) };
  } catch (error) {
    const retryable = !(
      typeof error === "object" &&
      error !== null &&
      "retryable" in error &&
      error.retryable === false
    );
    return {
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
      retryable,
    };
  }
}

/**
 * The heavy self-test (B8 step 8): `params.fail` drives the failure proofs.
 * @param {RenderJob} job
 * @returns {{ rendered_at: string }}
 */
function selftest(job) {
  const params = /** @type {{ fail?: unknown }} */ (job.payload.params ?? {});
  if (params.fail === "throw") throw new Error("selftest_throw");
  if (params.fail === "nonretryable") throw final("selftest_nonretryable");
  return { rendered_at: new Date().toISOString() };
}

/**
 * @param {unknown} value
 * @returns {value is { run: (job: RenderJob) => Promise<unknown> }}
 */
function hasRun(value) {
  return (
    typeof value === "object" && value !== null && "run" in value && typeof value.run === "function"
  );
}

/**
 * @param {unknown} raw the text of `MOP_JOB`
 * @returns {Promise<unknown>}
 */
export async function runJob(raw) {
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(String(raw));
  } catch {
    throw final("job_unreadable");
  }
  const job = checkJob(parsed);
  const script = scriptFor(job.type);
  if (script === INLINE) return selftest(job);
  const url = script === null ? null : new URL(`../${script}`, import.meta.url);
  if (url === null || !existsSync(url)) throw final("not_implemented");
  /** @type {unknown} */
  const loaded = await import(url.href);
  if (!hasRun(loaded)) throw final("not_implemented");
  return loaded.run(job);
}

if (import.meta.main) {
  const temp = process.env["RUNNER_TEMP"];
  if (temp === undefined || temp === "") {
    console.error("render-job: RUNNER_TEMP is not set");
    process.exit(1);
  }
  const outcome = await settleRun(runJob, process.env["MOP_JOB"]);
  await writeFile(join(temp, "result.json"), JSON.stringify(outcome));
  console.log(
    outcome.status === "done" ? "render-job: done" : `render-job: failed ${outcome.error}`,
  );
  if (outcome.status === "failed") process.exitCode = 1;
}
