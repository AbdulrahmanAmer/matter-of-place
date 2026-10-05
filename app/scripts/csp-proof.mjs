// Proves that a stored page carries the policy and the Link header the miss built (F25 j, F26 d) against a running
// `bunx wrangler dev` (E16): the Cache API works there and does nothing on workers.dev or in `vite dev`. The first
// request of each key must be a miss, so start the Worker with a fresh `--persist-to` folder.
// usage: node scripts/csp-proof.mjs <baseUrl>

import { createHash } from "node:crypto";
import { parse } from "parse5";

const USAGE = "usage: node scripts/csp-proof.mjs <baseUrl>";
const TIMEOUT_MS = 20_000;
const POLICY_HEADERS = ["content-security-policy", "content-security-policy-report-only"];

/** @typedef {{ status: number, headers: Headers, text: string }} Answer */

// The policy must hold the hash of every inline style and every inline script that runs: TanStack's `class="$tsr"`
// bootstrap and the allow-listed scroll-restoration script (SEC-03). A hash covers the text a parser reads (NUL becomes
// U+FFFD, CRLF becomes LF), so the text comes from parse5 (P-1903).
const EXECUTABLE_TYPES = ["", "module", "text/javascript", "application/javascript"];

/**
 * @param {string} page
 * @returns {string[]}
 */
function inlineSources(page) {
  /** @type {string[]} */
  const found = [];
  /** @param {import("parse5").DefaultTreeAdapterMap["node"]} node */
  const walk = (node) => {
    if (
      "tagName" in node &&
      (node.tagName === "style" ||
        (node.tagName === "script" &&
          !node.attrs.some(({ name }) => name === "src") &&
          EXECUTABLE_TYPES.includes(
            node.attrs.find(({ name }) => name === "type")?.value.toLowerCase() ?? "",
          )))
    ) {
      found.push(node.childNodes.map((child) => ("value" in child ? child.value : "")).join(""));
    }
    if ("childNodes" in node) node.childNodes.forEach(walk);
  };
  walk(parse(page));
  return found;
}

/**
 * @param {URL} base
 * @param {string} path
 * @returns {Promise<Answer>}
 */
async function call(base, path) {
  const response = await fetch(new URL(path, base), {
    redirect: "manual",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return { status: response.status, headers: response.headers, text: await response.text() };
}

/** @param {Answer} answer */
const label = (answer) => answer.headers.get("x-mop-cache") ?? "none";

/** The policy header the answer carries: its name and value, or undefined when it has none. */
const policyOf = (/** @type {Answer} */ answer) => {
  for (const name of POLICY_HEADERS) {
    const value = answer.headers.get(name);
    if (value !== null) return { name, value };
  }
  return undefined;
};

/**
 * @param {string[]} failures
 * @param {string} name
 * @param {boolean} passed
 * @param {string} observed
 */
function check(failures, name, passed, observed) {
  process.stdout.write(`${passed ? "ok  " : "FAIL"} ${name}: ${observed}\n`);
  if (!passed) failures.push(name);
}

/**
 * The policy and `link` of `answer` must be present and byte-identical to the miss's.
 * @param {string[]} failures
 * @param {string} name
 * @param {Answer} miss
 * @param {Answer} answer
 */
function sameHeaders(failures, name, miss, answer) {
  const built = policyOf(miss);
  const read = policyOf(answer);
  check(
    failures,
    `${name} policy header`,
    built !== undefined && read?.name === built.name && read.value === built.value,
    built === undefined
      ? "missing on the miss"
      : `${built.name} ${read === undefined ? "missing" : "equal"}`,
  );
  const hashes = inlineSources(answer.text).map(
    (code) => `'sha256-${createHash("sha256").update(code).digest("base64")}'`,
  );
  const unlisted = hashes.filter((hash) => read?.value.includes(hash) !== true);
  check(
    failures,
    `${name} policy holds each inline script and style hash`,
    hashes.length > 0 && unlisted.length === 0,
    `${String(hashes.length - unlisted.length)} of ${String(hashes.length)}`,
  );
  const link = miss.headers.get("link");
  check(
    failures,
    `${name} link header`,
    link !== null && answer.headers.get("link") === link,
    link === null
      ? "missing on the miss"
      : answer.headers.get("link") === null
        ? "missing"
        : "equal",
  );
}

/**
 * @param {URL} base
 * @param {string[]} failures
 * @param {string} path
 */
async function provePage(base, failures, path) {
  const miss = await call(base, path);
  const hit = await call(base, path);
  check(
    failures,
    `GET ${path}`,
    miss.status === 200 && label(miss) === "miss" && hit.status === 200 && label(hit) === "hit",
    `${label(miss)} then ${label(hit)}`,
  );
  const version = miss.headers.get("x-catalog-version");
  check(
    failures,
    `GET ${path} x-catalog-version`,
    version !== null && hit.headers.get("x-catalog-version") === version,
    `${String(version)} then ${String(hit.headers.get("x-catalog-version"))}`,
  );
  sameHeaders(failures, `GET ${path}`, miss, miss);
  sameHeaders(failures, `GET ${path} again`, miss, hit);
  for (const query of ["x=1", "x=2"]) {
    const queried = await call(base, `${path}?${query}`);
    check(failures, `GET ${path}?${query}`, label(queried) === "hit", label(queried));
    sameHeaders(failures, `GET ${path}?${query}`, miss, queried);
  }
}

/** @param {string[]} argv */
async function main(argv) {
  const [target] = argv;
  if (argv.length !== 1 || target === undefined || !URL.canParse(target)) {
    process.stderr.write(`${USAGE}\n`);
    return 64;
  }
  const base = new URL(target);
  /** @type {string[]} */
  const failures = [];
  for (const path of ["/", "/properties"]) await provePage(base, failures, path);
  process.stdout.write(
    failures.length === 0 ? "csp-proof: ok\n" : `csp-proof: FAIL ${failures.join("; ")}\n`,
  );
  return failures.length === 0 ? 0 : 1;
}

process.exitCode = await main(process.argv.slice(2));
