import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// B17 step 12: the Mozilla Observatory grade of a deployed host. It fails the run below A only while the
// host sends an enforcing Content-Security-Policy; a report-only or absent policy prints the grade and exits 0.
const SCAN_URL = "https://observatory-api.mdn.mozilla.net/api/v2/scan";
const USAGE = "usage: node scripts/observatory.mjs <host>";
const HOST = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/i;
const GRADES = ["A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D+", "D", "D-", "F"];
const LOWEST_PASS = GRADES.indexOf("A");
const ENFORCING = "content-security-policy";
const TIMEOUT_MS = 60_000;
// GOTCHAS P-054: a script run from the laptop retries a failed connection three times.
const ATTEMPTS = 3;
const PAUSE_MS = 1_000;

/**
 * @typedef {(url: string, init: RequestInit) => Promise<Response>} FetchLike
 * @typedef {{ print?: (line: string) => void }} ObservatoryOptions
 */

/** @param {number} ms */
const pause = (ms) => new Promise((done) => setTimeout(done, ms));

/**
 * @param {FetchLike} fetchImpl
 * @param {string} url
 * @param {"POST" | "HEAD"} method
 * @returns {Promise<Response>}
 * @throws the error of the last attempt
 */
async function send(fetchImpl, url, method) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fetchImpl(url, { method, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (error) {
      if (attempt >= ATTEMPTS) throw error;
      await pause(PAUSE_MS);
    }
  }
}

/**
 * Scans `host`, prints its grade, and returns the exit code: 0 when the grade is A or better or the
 * policy is not enforcing, 1 when an enforcing policy comes with a grade below A, 2 when the scan or the
 * request for the policy cannot be read or answers an error status.
 * @param {string} host
 * @param {ObservatoryOptions} options
 * @param {FetchLike} fetchImpl
 * @returns {Promise<number>}
 */
export async function runObservatory(host, options, fetchImpl) {
  const print =
    options.print ??
    ((line) => {
      process.stdout.write(`${line}\n`);
    });
  /** @type {string} */
  let grade;
  /** @type {boolean} */
  let enforcing;
  try {
    const scan = await send(fetchImpl, `${SCAN_URL}?host=${encodeURIComponent(host)}`, "POST");
    /** @type {unknown} */
    const body = await scan.json();
    const result =
      /** @type {{ grade?: unknown, score?: unknown, error?: unknown, details_url?: unknown }} */ (
        body !== null && typeof body === "object" ? body : {}
      );
    if (!scan.ok || typeof result.grade !== "string" || !GRADES.includes(result.grade)) {
      print(
        `observatory: no grade for ${host}: status ${String(scan.status)}, error ${String(result.error)}`,
      );
      return 2;
    }
    grade = result.grade;
    print(`observatory: ${host} grade ${grade} score ${String(result.score)}`);
    print(`details: ${String(result.details_url)}`);
    const head = await send(fetchImpl, `https://${host}/`, "HEAD");
    if (!head.ok) {
      print(
        `observatory: ${host} answered the request for its policy with status ${String(head.status)}`,
      );
      return 2;
    }
    enforcing = head.headers.has(ENFORCING);
  } catch (error) {
    print(`observatory: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
  if (!enforcing) {
    print("policy: not enforcing, so the grade is reported and does not fail the run");
    return 0;
  }
  if (GRADES.indexOf(grade) > LOWEST_PASS) {
    print(`policy: enforcing, and ${grade} is below A`);
    return 1;
  }
  print("policy: enforcing, and the grade is A or better");
  return 0;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [host, ...rest] = process.argv.slice(2);
  if (host === undefined || rest.length > 0 || !HOST.test(host)) {
    process.stdout.write(`${USAGE}\n`);
    process.exit(2);
  }
  process.exitCode = await runObservatory(host, {}, (url, init) => fetch(url, init));
}
