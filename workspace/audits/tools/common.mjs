import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

/**
 * @typedef {null | boolean | number | string | unknown[] | Record<string, unknown>} Json what a sidecar key holds
 * @typedef {{ value: Json } | { notMeasured: string }} Outcome one sidecar key: a value, or the reason it is missing
 * @typedef {Record<string, Outcome>} Collected sidecar key to outcome
 * @typedef {(url: string, init?: RequestInit) => Promise<Response>} Fetch the part of `fetch` a collector uses
 * @typedef {{ status: number, stdout: string }} Ran
 * @typedef {{
 *   env: Record<string, string | undefined>,
 *   siteUrl: string,
 *   fetchImpl: Fetch,
 *   sleep: (ms: number) => Promise<void>,
 *   now: () => Date,
 *   run: (command: string, args: string[], cwd: string) => Ran,
 * }} Context everything a collector touches outside itself, so a test can stand in for each part
 */

export const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
export const APP_DIR = resolve(REPO_ROOT, "app");
export const PRODUCTION_HOST = "matterofplace.com";
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * @param {Json} value
 * @returns {Outcome}
 */
export const measured = (value) => ({ value });

/**
 * @param {string} reason
 * @returns {Outcome}
 */
export const notMeasured = (reason) => ({ notMeasured: reason });

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
export const isRecord = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>[]}
 */
export const recordsOf = (value) => (Array.isArray(value) ? value.filter(isRecord) : []);

/**
 * @param {unknown} value
 * @param {string} key
 * @returns {unknown}
 */
export const field = (value, key) => (isRecord(value) ? value[key] : undefined);

/**
 * A finite number, or a numeric string such as "99.98" (Search Console and the monitor API send both).
 * @param {unknown} value
 * @returns {number | null}
 */
export function numeric(value) {
  const parsed = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : null;
}

/**
 * @param {unknown} value
 * @returns {number} the number, or 0 when the answer has none
 */
export const count = (value) => numeric(value) ?? 0;

/**
 * @param {unknown} error
 * @returns {string}
 */
export const messageOf = (error) => (error instanceof Error ? error.message : String(error));

/**
 * @param {string} text
 * @returns {unknown} the parsed value, or null when the text is not JSON
 */
export function parseJsonOrNull(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * One request that never throws: a refused connection or a timeout is `status: 0` with the reason.
 * @param {Fetch} fetchImpl
 * @param {string} url
 * @param {RequestInit} [init]
 * @param {number} [timeoutMs]
 * @returns {Promise<{ status: number, text: string, reason: string }>}
 */
export async function getText(fetchImpl, url, init = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  try {
    const response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    return {
      status: response.status,
      text: await response.text(),
      reason: `HTTP ${String(response.status)}`,
    };
  } catch (error) {
    return { status: 0, text: "", reason: `request failed: ${messageOf(error)}` };
  }
}

/**
 * @param {Fetch} fetchImpl
 * @param {string} url
 * @param {RequestInit} [init]
 * @param {number} [timeoutMs]
 * @returns {Promise<{ status: number, json: unknown, reason: string }>}
 */
export async function getJson(fetchImpl, url, init, timeoutMs) {
  const answer = await getText(fetchImpl, url, init, timeoutMs);
  return { status: answer.status, json: parseJsonOrNull(answer.text), reason: answer.reason };
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {string} cwd
 * @returns {Ran}
 */
export function spawnRun(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", timeout: 300_000 });
  return { status: result.status ?? 1, stdout: `${result.stdout}${result.stderr}` };
}

/**
 * @param {Partial<Context>} [overrides]
 * @returns {Context}
 */
export function makeContext(overrides = {}) {
  const env = overrides.env ?? process.env;
  return {
    env,
    siteUrl: env["SITE_URL"] ?? "",
    fetchImpl: fetch,
    sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
    now: () => new Date(),
    run: spawnRun,
    ...overrides,
  };
}

/**
 * @param {string} metaUrl `import.meta.url` of the calling module
 * @returns {boolean} true when that module is the one `node` was started on
 */
export const isMain = (metaUrl) =>
  process.argv[1] !== undefined && pathToFileURL(resolve(process.argv[1])).href === metaUrl;

/**
 * The `--url` flag of a collector's command line, then `SITE_URL`.
 * @param {string[]} [argv]
 * @returns {Context}
 */
export function contextFromArgs(argv = process.argv.slice(2)) {
  const { values } = parseArgs({ args: argv, options: { url: { type: "string" } }, strict: false });
  return makeContext(
    typeof values.url === "string" ? { siteUrl: values.url.replace(/\/+$/, "") } : {},
  );
}

/**
 * @param {Collected} collected
 * @returns {string[]} one line per key
 */
export function describeCollected(collected) {
  return Object.entries(collected).map(([key, outcome]) =>
    "notMeasured" in outcome
      ? `Not measured: ${key} (${outcome.notMeasured})`
      : `${key}: ${JSON.stringify(outcome.value)}`,
  );
}

/**
 * Runs a collector from the command line and prints what it found. It exits 0 whatever it finds:
 * the findings are the report's job.
 * @param {string} metaUrl
 * @param {(ctx: Context) => Promise<Collected>} collect
 * @param {(collected: Collected) => string[]} [describe]
 * @returns {Promise<void>}
 */
export async function runCli(metaUrl, collect, describe = describeCollected) {
  if (!isMain(metaUrl)) return;
  const collected = await collect(contextFromArgs());
  process.stdout.write(`${describe(collected).join("\n")}\n`);
}
