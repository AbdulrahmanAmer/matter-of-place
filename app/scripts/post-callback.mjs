// The last step of render.yml's `render` job (B8 step 7), run under `if: always()`: signs the outcome that
// `render-job.mjs` wrote to `$RUNNER_TEMP/result.json` and posts it to the job's `callback_url`, with three retries.
// No result file means the runner died first: the callback says `failed`, `runner_crashed`, retryable.
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { callbackAllowed } from "./render-job.mjs";

const RETRIES = 3;
const BACKOFF_MS = 5000;
const TIMEOUT_MS = 30_000;

/**
 * The header `X-MOP-Signature` of B8's Contract, the same value as `signBody` of `src/server/lib/hmac.ts`.
 * @param {string} secret
 * @param {string} timestamp
 * @param {string} rawBody
 * @returns {string}
 */
export function signBody(secret, timestamp, rawBody) {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex")}`;
}

/**
 * @param {string} name
 * @returns {string}
 */
function required(name) {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`post-callback: ${name} is not set`);
  return value;
}

/**
 * @param {string} path
 * @returns {Promise<Record<string, unknown>>}
 */
async function readOutcome(path) {
  try {
    /** @type {unknown} */
    const outcome = JSON.parse(await readFile(path, "utf8"));
    if (typeof outcome !== "object" || outcome === null) throw new Error("not an object");
    return { ...outcome };
  } catch (error) {
    console.error(`post-callback: no outcome at ${path}: ${String(error)}`);
    return { status: "failed", error: "runner_crashed", retryable: true };
  }
}

/**
 * One signed POST; a fresh timestamp each time, so a retry is never older than the hook's window.
 * @param {string} url
 * @param {string} secret
 * @param {string} body
 * @returns {Promise<number>} the status, or 0 when the request did not complete
 */
async function post(url, secret, body) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-mop-timestamp": timestamp,
        "x-mop-signature": signBody(secret, timestamp, body),
      },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    console.log(`post-callback: ${String(response.status)} ${await response.text()}`);
    return response.status;
  } catch (error) {
    console.error(`post-callback: ${String(error)}`);
    return 0;
  }
}

if (import.meta.main) {
  /** @type {unknown} */
  const job = JSON.parse(required("MOP_JOB"));
  if (typeof job !== "object" || job === null || !("job_id" in job && "claim" in job)) {
    console.error("post-callback: job_unreadable");
    process.exit(1);
  }
  const { job_id, claim } = job;
  const callback_url = "callback_url" in job ? job.callback_url : undefined;
  if (typeof callback_url !== "string" || !callbackAllowed(callback_url)) {
    console.error("post-callback: callback_refused");
    process.exit(1);
  }
  const outcome = await readOutcome(join(required("RUNNER_TEMP"), "result.json"));
  const runUrl = `${required("GITHUB_SERVER_URL")}/${required("GITHUB_REPOSITORY")}/actions/runs/${required("GITHUB_RUN_ID")}`;
  const body = JSON.stringify({ ...outcome, job_id, claim, run_url: runUrl });
  const secret = required("RENDER_CALLBACK_SECRET");
  let status = await post(callback_url, secret, body);
  for (let retry = 1; retry <= RETRIES && (status === 0 || status >= 500); retry += 1) {
    await new Promise((resolve) => setTimeout(resolve, BACKOFF_MS * retry));
    status = await post(callback_url, secret, body);
  }
  if (status !== 200) process.exit(1);
}
