// The outside-in coming-soon verification of L1 step 5 (S30): one line per check, `ok` or `red`, exit 1 on any red
// line. `--expect-signup` reads the one database through DEV_DB_URL (ruling H35); the signup itself is made by a person
// in a browser, because production Turnstile cannot be passed by a script (B3b).
// usage: node scripts/launch/verify-production.mjs <baseUrl> [--expect-signup <email>] [--expect-csp report-only|enforce]
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import pg from "pg";
import { pgClientConfig } from "../lib/pg-connect.mjs";

const USAGE =
  "usage: node scripts/launch/verify-production.mjs <baseUrl> [--expect-signup <email>] [--expect-csp report-only|enforce]";
const APP = fileURLToPath(new URL("../../", import.meta.url));
const TIMEOUT_MS = 20_000;
const MARKETS = ["/california", "/new-york", "/florida"];
const EMPTY_STATE = "No property is listed";
// `illustrativeContent` is a key of the dehydrated state on every page, not shown text (P-3411).
const ILLUSTRATIVE = /illustrative(?!Content)/i;
const POLICY = {
  "report-only": "content-security-policy-report-only",
  enforce: "content-security-policy",
};

/** @typedef {{ status: number, headers: Headers, body: string }} Answer */

/** @type {string[]} */
const red = [];

/**
 * @param {string} name
 * @param {boolean} passed
 * @param {string} observed
 */
function line(name, passed, observed) {
  process.stdout.write(`${passed ? "ok " : "red"}  ${name}: ${observed}\n`);
  if (!passed) red.push(name);
}

/**
 * The answer, or the error text when the request could not be made.
 * @param {string} url
 * @returns {Promise<Answer | string>}
 */
async function call(url) {
  try {
    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return { status: response.status, headers: response.headers, body: await response.text() };
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/**
 * @param {string} text
 * @param {string} needle
 */
const count = (text, needle) => text.split(needle).length - 1;

/**
 * @param {string} name
 * @param {Answer | string} answer
 * @param {(answer: Answer) => string | undefined} fault the fault of a 200 answer, undefined when it is fine
 * @param {string} okText
 */
function check200(name, answer, fault, okText) {
  if (typeof answer === "string") {
    line(name, false, answer);
    return;
  }
  if (answer.status !== 200) {
    line(name, false, `answered ${String(answer.status)}`);
    return;
  }
  const found = fault(answer);
  line(name, found === undefined, found ?? okText);
}

/**
 * @param {string} name
 * @param {Answer | string} answer
 * @param {string} location
 * @param {number[]} statuses
 */
function checkRedirect(name, answer, location, statuses) {
  if (typeof answer === "string") {
    line(name, false, answer);
    return;
  }
  const to = answer.headers.get("location");
  line(
    name,
    statuses.includes(answer.status) && to === location,
    `${String(answer.status)} location ${String(to)}`,
  );
}

/**
 * @param {URL} base
 * @param {"report-only" | "enforce"} expected
 */
async function checkPolicy(base, expected) {
  const answer = await call(base.href);
  if (typeof answer === "string") {
    line("policy", false, answer);
    return;
  }
  const want = POLICY[expected];
  const other = expected === "enforce" ? POLICY["report-only"] : POLICY.enforce;
  const has = (/** @type {string} */ name) => answer.headers.get(name) !== null;
  line(
    "policy",
    has(want) && !has(other),
    `${want} ${has(want) ? "present" : "missing"}, ${other} ${has(other) ? "present" : "absent"}`,
  );
}

/** @param {string} email */
async function checkSignup(email) {
  const client = new pg.Client(pgClientConfig(process.env["DEV_DB_URL"]));
  await client.connect();
  try {
    /** @type {import("pg").QueryResult<{ markets: string[] }>} */
    const result = await client.query("select markets from subscribers where email = $1", [email]);
    const [row] = result.rows;
    line(
      "signup",
      result.rows.length === 1 && row !== undefined && row.markets.length > 0,
      `${String(result.rows.length)} rows, markets ${row?.markets.join(",") ?? "none"}`,
    );
  } finally {
    await client.end();
  }
}

/**
 * @param {URL} base
 * @param {{ signup: string | undefined, csp: "report-only" | "enforce" | undefined }} options
 */
async function verify(base, { signup, csp }) {
  const at = (/** @type {string} */ path) => new URL(path, base).href;
  check200(
    "no illustrative",
    await call(at("/properties")),
    (answer) => (ILLUSTRATIVE.test(answer.body) ? "/properties says illustrative" : undefined),
    "/properties has no illustrative text",
  );
  /** @type {string[]} */
  const empty = [];
  for (const path of MARKETS) {
    check200(
      `empty ${path}`,
      await call(at(path)),
      (answer) => {
        if (!answer.body.includes(EMPTY_STATE)) return `no "${EMPTY_STATE}"`;
        empty.push(path);
        // A page that names its market renders the signup without the market chooser (B3b interest form).
        return answer.body.includes('class="interest-form"') &&
          !answer.body.includes('class="interest-chooser"')
          ? undefined
          : "no signup form with the market preselected";
      },
      "empty state and signup with the market preselected",
    );
  }
  check200(
    "sitemap",
    await call(at("/sitemap.xml")),
    (answer) => {
      const listed = [
        ...(answer.body.includes("/property/") ? ["a /property/ URL"] : []),
        ...empty.filter((path) => answer.body.includes(`<loc>${base.origin}${path}</loc>`)),
      ];
      return listed.length === 0 ? undefined : `lists ${listed.join(", ")}`;
    },
    "no /property/ URL and no empty market",
  );
  check200(
    "home cards",
    await call(at("/")),
    (answer) => {
      const markets = count(answer.body, 'class="market-card"');
      const properties = count(answer.body, 'class="property-card"');
      return markets === 3 && properties === 0
        ? undefined
        : `${String(markets)} market cards, ${String(properties)} property cards`;
    },
    "3 market cards, 0 property cards",
  );
  check200(
    "robots",
    await call(at("/robots.txt")),
    (answer) => {
      const lines = answer.body.split(/\r?\n/).map((text) => text.trim());
      const faults = [
        ...(answer.headers.get("x-robots-tag") === null ? [] : ["x-robots-tag header"]),
        ...(lines.includes(`Sitemap: ${base.origin}/sitemap.xml`) ? [] : ["no Sitemap line"]),
        ...(lines.includes("Disallow: /") ? ["Disallow: /"] : []),
      ];
      return faults.length === 0 ? undefined : faults.join(", ");
    },
    "indexable rules with the sitemap",
  );
  const llms = spawnSync("bun", ["run", "scripts/validate-llms.ts", base.origin], {
    cwd: APP,
    encoding: "utf8",
  });
  line(
    "llms.txt",
    llms.status === 0,
    `validate-llms exit ${String(llms.status)}${llms.status === 0 ? "" : `: ${llms.stdout.trim()}`}`,
  );
  checkRedirect("www redirect", await call(`https://www.${base.host}/`), `${base.origin}/`, [301]);
  checkRedirect(
    "https redirect",
    await call(`http://${base.host}/`),
    `https://${base.host}/`,
    [301, 302, 307, 308],
  );
  if (csp !== undefined) await checkPolicy(base, csp);
  if (signup !== undefined) await checkSignup(signup);
}

/**
 * @param {string[]} argv
 * @returns {Promise<number>}
 */
async function main(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    options: { "expect-signup": { type: "string" }, "expect-csp": { type: "string" } },
    allowPositionals: true,
  });
  const [baseUrl, ...extra] = positionals;
  const csp = values["expect-csp"];
  if (
    baseUrl === undefined ||
    extra.length > 0 ||
    !URL.canParse(baseUrl) ||
    (csp !== undefined && csp !== "report-only" && csp !== "enforce")
  ) {
    process.stderr.write(`${USAGE}\n`);
    return 64;
  }
  await verify(new URL(baseUrl), { signup: values["expect-signup"], csp });
  process.stdout.write(
    red.length === 0 ? "verify-production: ok\n" : `verify-production: red ${red.join("; ")}\n`,
  );
  return red.length === 0 ? 0 : 1;
}

process.exitCode = await main(process.argv.slice(2));
