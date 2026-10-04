import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The smoke list of B1b step 6 (gate G22): run at the end of every deploy job and by hand.
const PAGES = [
  "/",
  "/properties",
  "/markets",
  "/california",
  "/stories",
  "/submit",
  "/contact",
  "/sitemap.xml",
];
const MEDIA_FILE = "/media/tiburon-waterline.mp4";
const HOOK = "/api/hooks/sentry-test";
const API_READ = "/api/public/properties";
const API_BEACON = "/api/public/events";
const SERVICES = /<body[^>]*\sdata-services="([^"]*)"/;
const NOINDEX = "noindex, nofollow";
const ASSET_SCRIPT = /["'](\/assets\/[^"'?#]+\.js)["']/;
const USAGE = "usage: node scripts/smoke.mjs <baseUrl> [--expect-noindex|--expect-indexable]";
const TIMEOUT_MS = 20_000;
// GOTCHAS P-054: a script run from the laptop retries a failed connection three times.
const ATTEMPTS = 3;
const PAUSE_MS = 1_000;

/**
 * @typedef {(url: string, init: RequestInit) => Promise<Response>} FetchLike
 * @typedef {"noindex" | "indexable"} Robots
 * @typedef {{
 *   robots?: Robots | undefined,
 *   forceFail?: string | undefined,
 *   print?: (line: string) => void,
 * }} SmokeOptions
 */

/**
 * Every `.workers.dev` host must be noindex and `matterofplace.com` must be indexable (G19, B13
 * invariant 5); any other host follows the flag, noindex by default. Null when the flag
 * contradicts the host.
 * @param {string} hostname
 * @param {Robots | undefined} flag
 * @returns {Robots | null}
 */
function robotsFor(hostname, flag) {
  const required = hostname.endsWith(".workers.dev")
    ? "noindex"
    : hostname === "matterofplace.com"
      ? "indexable"
      : undefined;
  if (required === undefined) return flag ?? "noindex";
  return flag === undefined || flag === required ? required : null;
}

/** @param {number} ms */
const pause = (ms) => new Promise((done) => setTimeout(done, ms));

/**
 * @param {FetchLike} fetchImpl
 * @param {string} url
 * @param {string} method
 * @returns {Promise<Response | string>} the response, or the error of the last attempt
 */
async function request(fetchImpl, url, method) {
  let failure = "";
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    try {
      return await fetchImpl(url, {
        method,
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
      if (attempt < ATTEMPTS) await pause(PAUSE_MS);
    }
  }
  return `no answer after ${String(ATTEMPTS)} attempts: ${failure}`;
}

/**
 * Runs the smoke list against `baseUrl` and returns the exit code: 0 when every check passes,
 * 1 when one fails (each failing URL is printed), 2 when the robots flag contradicts the host.
 * @param {string} baseUrl
 * @param {SmokeOptions} options
 * @param {FetchLike} fetchImpl
 * @returns {Promise<number>}
 */
export async function runSmoke(baseUrl, options, fetchImpl) {
  const print =
    options.print ??
    ((line) => {
      process.stdout.write(`${line}\n`);
    });
  // The dev job's rollback rehearsal (DO-09) forces a red smoke without any request.
  if (options.forceFail === "1") {
    print("smoke forced to fail (SMOKE_FORCE_FAIL)");
    return 1;
  }
  const base = new URL(baseUrl);
  const robots = robotsFor(base.hostname, options.robots);
  if (robots === null) {
    print(USAGE);
    print(`--expect-${String(options.robots)} contradicts the host ${base.hostname}`);
    return 2;
  }

  /** @type {string[]} */
  const failed = [];
  /**
   * @param {string} url
   * @param {string[]} problems
   */
  const report = (url, problems) => {
    if (problems.length === 0) {
      print(`ok   ${url}`);
      return;
    }
    failed.push(url);
    print(`FAIL ${url}: ${problems.join("; ")}`);
  };
  /**
   * @param {string} path
   * @param {string} [method]
   */
  const call = async (path, method = "GET") => {
    const url = new URL(path, base).href;
    return { url, answer: await request(fetchImpl, url, method) };
  };

  let home = "";
  let firstId = "";
  for (const path of PAGES) {
    const { url, answer } = await call(path);
    if (typeof answer === "string") {
      report(url, [answer]);
      continue;
    }
    const headers = answer.headers;
    const problems = [];
    if (answer.status !== 200) problems.push(`status ${String(answer.status)}`);
    if (headers.get("x-request-id") === null) problems.push("no x-request-id");
    if (headers.get("x-content-type-options") !== "nosniff") problems.push("no nosniff");
    if (headers.get("x-frame-options") !== "DENY") problems.push("x-frame-options not DENY");
    const robotsTag = headers.get("x-robots-tag");
    if (robots === "noindex" && robotsTag !== NOINDEX)
      problems.push(`x-robots-tag ${robotsTag ?? "missing"}, expected ${NOINDEX}`);
    if (robots === "indexable" && robotsTag !== null)
      problems.push(`x-robots-tag ${robotsTag}, expected none`);
    if (path === "/") {
      const cacheControl = headers.get("cache-control") ?? "";
      if (!cacheControl.includes("max-age=0") || !cacheControl.includes("must-revalidate"))
        problems.push(`cache-control ${cacheControl}, expected max-age=0 and must-revalidate`);
      home = await answer.text();
      firstId = headers.get("x-request-id") ?? "";
    }
    report(url, problems);
  }

  // The id is never stored with a cached render, so two requests carry two ids.
  const again = await call("/");
  if (typeof again.answer === "string") report(again.url, [again.answer]);
  else {
    const secondId = again.answer.headers.get("x-request-id");
    report(again.url, secondId !== null && secondId === firstId ? ["same x-request-id twice"] : []);
  }

  // Nitro appends the immutable rule for fingerprinted assets (ruling H39 (7)).
  const script = ASSET_SCRIPT.exec(home)?.[1];
  if (script === undefined) report(new URL("/", base).href, ["no /assets/*.js in the HTML"]);
  else {
    const asset = await call(script, "HEAD");
    if (typeof asset.answer === "string") report(asset.url, [asset.answer]);
    else {
      const cacheControl = asset.answer.headers.get("cache-control") ?? "";
      const problems = [];
      if (asset.answer.status !== 200) problems.push(`status ${String(asset.answer.status)}`);
      if (!cacheControl.includes("immutable") || !cacheControl.includes("max-age=31536000"))
        problems.push(`cache-control ${cacheControl}, expected immutable, max-age=31536000`);
      if (asset.answer.headers.get("x-content-type-options") !== "nosniff")
        problems.push("no nosniff");
      report(asset.url, problems);
    }
  }

  // Our public/_headers reaches the deployed static files.
  const media = await call(MEDIA_FILE, "HEAD");
  if (typeof media.answer === "string") report(media.url, [media.answer]);
  else {
    const cacheControl = media.answer.headers.get("cache-control") ?? "";
    const problems = [];
    if (media.answer.status !== 200) problems.push(`status ${String(media.answer.status)}`);
    if (!cacheControl.includes("max-age=604800"))
      problems.push(`cache-control ${cacheControl}, expected max-age=604800`);
    report(media.url, problems);
  }

  // Forced means set, not merged (G65): any status, exactly no-store.
  const hook = await call(HOOK, "POST");
  if (typeof hook.answer === "string") report(hook.url, [hook.answer]);
  else {
    const cacheControl = hook.answer.headers.get("cache-control");
    report(hook.url, cacheControl === "no-store" ? [] : [`cache-control ${String(cacheControl)}`]);
  }

  // The read path answers only on a live build. After the launch switch a preview and the dev Worker run the
  // local adapter and hold no database key (H35 (7)); the production Worker is always live.
  const services = SERVICES.exec(home)?.[1];
  if (services === "local") print("api checks skipped (local adapter)");
  else if (services !== "live")
    report(new URL("/", base).href, [`data-services ${String(services)}`]);
  else {
    const properties = await call(API_READ);
    if (typeof properties.answer === "string") report(properties.url, [properties.answer]);
    else {
      const headers = properties.answer.headers;
      const cache = headers.get("x-mop-cache");
      const problems = [];
      if (properties.answer.status !== 200)
        problems.push(`status ${String(properties.answer.status)}`);
      // A stale answer after a deploy means the new Worker cannot read the database (DO-09).
      if (cache !== "hit" && cache !== "miss")
        problems.push(`x-mop-cache ${String(cache)}, expected hit or miss`);
      if (headers.get("x-catalog-version") === null) problems.push("no x-catalog-version");
      report(properties.url, problems);
    }
    const events = await call(API_BEACON, "POST");
    if (typeof events.answer === "string") report(events.url, [events.answer]);
    else {
      const cache = events.answer.headers.get("x-mop-cache");
      report(
        events.url,
        cache === "bypass" ? [] : [`x-mop-cache ${String(cache)}, expected bypass`],
      );
    }
  }

  if (failed.length > 0) {
    print(`smoke: FAILED ${String(failed.length)}: ${failed.join(" ")}`);
    return 1;
  }
  print(`smoke: OK ${base.origin}`);
  return 0;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const flags = args.filter((arg) => arg.startsWith("--"));
  const [baseUrl, ...rest] = args.filter((arg) => !arg.startsWith("--"));
  /** @type {Robots | undefined} */
  const robots = flags.includes("--expect-indexable")
    ? "indexable"
    : flags.includes("--expect-noindex")
      ? "noindex"
      : undefined;
  const known = flags.every((flag) => ["--expect-noindex", "--expect-indexable"].includes(flag));
  if (
    baseUrl === undefined ||
    rest.length > 0 ||
    flags.length > 1 ||
    !known ||
    !URL.canParse(baseUrl)
  ) {
    process.stdout.write(`${USAGE}\n`);
    process.exit(2);
  }
  process.exitCode = await runSmoke(
    baseUrl,
    { robots, forceFail: process.env["SMOKE_FORCE_FAIL"] },
    (url, init) => fetch(url, init),
  );
}
