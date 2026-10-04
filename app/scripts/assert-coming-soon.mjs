import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { z } from "zod";

// The production deploy's proof that coming-soon mode holds (B3b step 9, H35 (4)): no property, three markets
// coming soon, no illustrative wording or property card on `/` and `/properties`, and the California empty
// state. With `--after-launch` only the illustrative check runs, since a published property and an open market
// are then expected (G47). Nothing is retried: a fetch error or a non-200 answer fails its check.
// usage: node scripts/assert-coming-soon.mjs <baseUrl> [--after-launch]

const USAGE = "usage: node scripts/assert-coming-soon.mjs <baseUrl> [--after-launch]";
const TIMEOUT_MS = 20_000;
const NO_PROPERTIES = z.array(z.unknown()).length(0);
const MARKETS_COMING_SOON = z.array(z.object({ comingSoon: z.literal(true) })).length(3);
const PAGES = ["/", "/properties"];
const ILLUSTRATIVE = /illustrative/i;
const CARD = 'class="property-card"';
const CALIFORNIA = "No property is listed in California yet.";

/**
 * @typedef {(url: string, init?: RequestInit) => Promise<Response>} Fetch
 * @typedef {{ afterLaunch: boolean, fetch: Fetch }} Options
 */

/**
 * Returns the names of the failed checks, in check order; empty when every check passes.
 * @param {string} baseUrl
 * @param {Options} options
 * @returns {Promise<string[]>}
 */
export async function runChecks(baseUrl, { afterLaunch, fetch }) {
  /** @type {Map<string, Promise<string | undefined>>} */
  const bodies = new Map();
  /**
   * The body of a 200 answer, or undefined after a fetch error or any other status.
   * @param {string} path
   */
  const body = (path) => {
    let pending = bodies.get(path);
    if (pending === undefined) {
      pending = fetch(new URL(path, baseUrl).href, {
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      }).then(
        (answer) => (answer.status === 200 ? answer.text() : undefined),
        () => undefined,
      );
      bodies.set(path, pending);
    }
    return pending;
  };
  /**
   * @param {string} path
   * @param {z.ZodType} schema
   */
  const answers = async (path, schema) => {
    const text = await body(path);
    if (text === undefined) return false;
    try {
      return schema.safeParse(JSON.parse(text)).success;
    } catch {
      return false;
    }
  };
  /** @param {(html: string) => boolean} clean */
  const pagesAre = async (clean) => {
    const pages = await Promise.all(PAGES.map(body));
    return pages.every((html) => html !== undefined && clean(html));
  };

  /** @type {[string, () => Promise<boolean>][]} */
  const checks = [["no-illustrative", () => pagesAre((html) => !ILLUSTRATIVE.test(html))]];
  if (!afterLaunch)
    checks.push(
      ["properties", () => answers("/api/public/properties", NO_PROPERTIES)],
      ["markets", () => answers("/api/public/markets", MARKETS_COMING_SOON)],
      ["property-card", () => pagesAre((html) => !html.includes(CARD))],
      ["california", async () => (await body("/california"))?.includes(CALIFORNIA) === true],
    );

  const passed = await Promise.all(checks.map(([, passes]) => passes()));
  return checks.filter((_, at) => passed[at] !== true).map(([name]) => name);
}

/**
 * The base URL and the mode, or undefined for an unknown option, a missing or extra argument, or a bad URL.
 * @returns {{ baseUrl: string, afterLaunch: boolean } | undefined}
 */
function parseCommandLine() {
  try {
    const { values, positionals } = parseArgs({
      options: { "after-launch": { type: "boolean", default: false } },
      allowPositionals: true,
    });
    const [baseUrl, ...rest] = positionals;
    if (baseUrl === undefined || rest.length > 0 || !URL.canParse(baseUrl)) return undefined;
    return { baseUrl, afterLaunch: values["after-launch"] };
  } catch {
    return undefined;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = parseCommandLine();
  if (args === undefined) {
    process.stdout.write(`${USAGE}\n`);
    process.exit(2);
  }
  const { baseUrl, afterLaunch } = args;
  const failed = await runChecks(baseUrl, {
    afterLaunch,
    fetch: (url, init) => fetch(url, init),
  });
  for (const name of failed) process.stdout.write(`FAIL ${name}\n`);
  if (failed.length === 0) process.stdout.write(`ok   coming-soon checks on ${baseUrl}\n`);
  process.exitCode = failed.length === 0 ? 0 : 1;
}
