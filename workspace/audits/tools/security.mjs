import { field, getText, measured, messageOf, notMeasured, recordsOf, runCli } from "./common.mjs";

// The security collector (B14 step 5). It reads response headers and the served JavaScript, sends no cookie, and
// sends 61 requests to the search route to see the per-IP limit answer 429. It exits 0 whatever it finds: the rows
// are the report's job. Statuses: `ok`, `watch` (look at it, not a failure) and `red`.
const TIMEOUT_MS = 30_000;
const FORM_PAGES = ["/", "/contact", "/submit", "/privacy-request"];
const MAX_SCRIPTS = 300;
const TURNSTILE_HOST = "challenges.cloudflare.com";
const PROBE_PATH = "/api/public/search";
const PROBE_REQUESTS = 61;
const MINUTE_MS = 60_000;
const LOCAL_HOSTS = ["127.0.0.1", "localhost", "[::1]"];

/** What a served script must never hold: the agent key prefix, a secret-key prefix, a PEM block. */
const SECRET_PATTERNS = [
  { name: "mopk_", pattern: /\bmopk_[A-Za-z0-9_-]{20,}/ },
  { name: "sk_", pattern: /\bsk_[A-Za-z0-9_]{16,}/ },
  { name: "-----BEGIN", pattern: /-----BEGIN / },
];

/**
 * @typedef {{ check: string, status: "ok" | "watch" | "red", detail: string }} SecurityRow
 * @typedef {{ get: (name: string) => string | null }} HeaderSource the part of `Headers` the parser reads
 * @typedef {{ status: number, headers: HeaderSource | null, text: string, reason: string }} Page
 */

/**
 * @param {string} check
 * @param {SecurityRow["status"]} status
 * @param {string} detail
 * @returns {SecurityRow}
 */
const row = (check, status, detail) => ({ check, status, detail });

/**
 * The four headers of a response. A missing HSTS, X-Frame-Options or Referrer-Policy is red. A CSP sent only as
 * `Content-Security-Policy-Report-Only` is `watch` (F10: enforcing comes with `flags.csp_enforce`), no CSP is red.
 * @param {HeaderSource} headers
 * @returns {SecurityRow[]}
 */
export function parseSecurityHeaders(headers) {
  const enforcing = headers.get("content-security-policy");
  const reportOnly = headers.get("content-security-policy-report-only");
  /** @type {SecurityRow} */
  let csp = row("content-security-policy", "red", "no Content-Security-Policy header");
  if (enforcing !== null) csp = row("content-security-policy", "ok", "enforcing");
  else if (reportOnly !== null) {
    csp = row("content-security-policy", "watch", "Report-Only, not enforcing yet (F10)");
  }
  /** @type {[string, string][]} */
  const required = [
    ["strict-transport-security", "Strict-Transport-Security"],
    ["x-frame-options", "X-Frame-Options"],
    ["referrer-policy", "Referrer-Policy"],
  ];
  return [
    csp,
    ...required.map(([name, label]) => {
      const value = headers.get(name);
      return value === null
        ? row(name, "red", `no ${label} header`)
        : row(name, "ok", `${label}: ${value}`);
    }),
  ];
}

/**
 * One GET that never throws and keeps the headers.
 * @param {import("./common.mjs").Context} ctx
 * @param {string} url
 * @returns {Promise<Page>}
 */
async function getPage(ctx, url) {
  try {
    const response = await ctx.fetchImpl(url, {
      method: "GET",
      headers: { accept: "text/html,*/*" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return {
      status: response.status,
      headers: response.headers,
      text: await response.text(),
      reason: `HTTP ${String(response.status)}`,
    };
  } catch (error) {
    return {
      status: 0,
      headers: null,
      text: "",
      reason: `request failed: ${messageOf(error)}`,
    };
  }
}

/**
 * The same-origin scripts a page loads: `<script src>` and `<link rel="modulepreload">`.
 * @param {string} html
 * @param {string} pageUrl
 * @returns {string[]} absolute URLs, once each
 */
export function scriptUrls(html, pageUrl) {
  const origin = new URL(pageUrl).origin;
  /** @type {Set<string>} */
  const found = new Set();
  for (const [tag, name = ""] of html.matchAll(/<(script|link)\b[^>]*>/gi)) {
    const isScript = name.toLowerCase() === "script";
    if (!isScript && !/\brel=["']?modulepreload/i.test(tag)) continue;
    const target = tag.match(
      isScript ? /\bsrc=["']([^"']+)["']/i : /\bhref=["']([^"']+)["']/i,
    )?.[1];
    if (target === undefined) continue;
    const url = new URL(target, pageUrl);
    if (url.origin === origin) found.add(url.href);
  }
  return [...found];
}

/**
 * The scripts one script imports by a relative path, statically or with `import()`. Vite splits the code into chunks and
 * the Turnstile loader sits in one that the entry script loads with a dynamic import, so a page's own tags do not
 * name it.
 * @param {string} text the body of the script
 * @param {string} scriptUrl
 * @returns {string[]} absolute URLs, once each
 */
export function importedUrls(text, scriptUrl) {
  /** @type {Set<string>} */
  const found = new Set();
  for (const [, target = ""] of text.matchAll(
    /\b(?:from|import)\s*\(?\s*[`"'](\.{1,2}\/[^`"']+\.js)[`"']/g,
  )) {
    found.add(new URL(target, scriptUrl).href);
  }
  return [...found];
}

/**
 * @param {string[]} roots
 * @param {Map<string, string[]>} imports script URL to the scripts it imports
 * @returns {string[]} the roots and every script reachable from them, once each
 */
export function reachable(roots, imports) {
  const seen = new Set(roots);
  for (const url of seen) for (const next of imports.get(url) ?? []) seen.add(next);
  return [...seen];
}

/**
 * @param {string} text
 * @returns {string[]} the names of the secret patterns found in `text`, never the matched text
 */
export const secretsIn = (text) =>
  SECRET_PATTERNS.filter(({ pattern }) => pattern.test(text)).map(({ name }) => name);

/**
 * The secret row and the Turnstile row from what the probed pages served.
 * @param {{ path: string, hasForm: boolean, scripts: string[] }[]} pages
 * @param {Map<string, string | null>} bodies script URL to its text, null when it could not be read
 * @returns {SecurityRow[]}
 */
export function judgeScripts(pages, bodies) {
  const hits = [];
  let unreadable = 0;
  for (const [url, text] of bodies) {
    if (text === null) unreadable += 1;
    else for (const name of secretsIn(text)) hits.push(`${name} in ${new URL(url).pathname}`);
  }
  /** @type {SecurityRow} */
  let secrets = row(
    "secrets_in_js",
    "ok",
    `scripts read: ${String(bodies.size)}, none holds a secret pattern`,
  );
  if (hits.length > 0) secrets = row("secrets_in_js", "red", hits.join(", "));
  else if (unreadable > 0 || bodies.size === 0) {
    secrets = row(
      "secrets_in_js",
      "watch",
      `${String(unreadable)} of ${String(bodies.size)} scripts could not be read`,
    );
  }
  const formPages = pages.filter((page) => page.hasForm);
  const bare = formPages.filter(
    (page) => !page.scripts.some((url) => bodies.get(url)?.includes(TURNSTILE_HOST) === true),
  );
  /** @type {SecurityRow} */
  let forms = row(
    "forms_turnstile",
    "ok",
    `${String(formPages.length)} pages with a form load a script that names Turnstile`,
  );
  if (formPages.length === 0) {
    forms = row("forms_turnstile", "watch", "no form found on the probed pages");
  } else if (bare.length > 0) {
    forms = row(
      "forms_turnstile",
      "red",
      `no script that ${bare.map((page) => page.path).join(", ")} loads or imports names Turnstile`,
    );
  }
  return [secrets, forms];
}

/**
 * 61 POSTs of the search route, stopping at the first 429. Under a local preview (one isolate) no 429 is red; on a
 * deployed host it is `watch`, because the memory limit is per isolate (B3) and the Cloudflare rule is H1's proof.
 * @param {import("./common.mjs").Context} ctx
 * @param {string} base
 * @returns {Promise<SecurityRow>}
 */
export async function probeRateLimit(ctx, base) {
  const started = ctx.now().getTime();
  for (let sent = 1; sent <= PROBE_REQUESTS; sent += 1) {
    const answer = await getText(
      ctx.fetchImpl,
      `${base}${PROBE_PATH}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "audit probe" }),
      },
      TIMEOUT_MS,
    );
    if (answer.status === 0) return row("rate_limit_search", "watch", answer.reason);
    if (answer.status === 429) {
      return row(
        "rate_limit_search",
        "ok",
        `429 on request ${String(sent)} of ${String(PROBE_REQUESTS)}`,
      );
    }
  }
  const seconds = Math.round((ctx.now().getTime() - started) / 1000);
  const took = `${String(PROBE_REQUESTS)} requests in ${String(seconds)} seconds, no 429`;
  if (seconds * 1000 >= MINUTE_MS) {
    return row("rate_limit_search", "watch", `${took}: slower than the one-minute window`);
  }
  const local = LOCAL_HOSTS.includes(new URL(base).hostname);
  return local
    ? row("rate_limit_search", "red", `${took}: one isolate, the limit is 60 a minute`)
    : row("rate_limit_search", "watch", `${took}: the memory limit is per isolate`);
}

/**
 * @param {import("./common.mjs").Context} ctx
 * @returns {Promise<{ host: string, checks: SecurityRow[] } | { reason: string }>}
 */
export async function probe(ctx) {
  const base = ctx.siteUrl.replace(/\/+$/, "");
  const home = await getPage(ctx, `${base}/`);
  if (home.headers === null) return { reason: `${base}/ ${home.reason}` };
  const pages = [];
  for (const path of FORM_PAGES) {
    const page = path === "/" ? home : await getPage(ctx, `${base}${path}`);
    if (page.status === 200) {
      pages.push({
        path,
        hasForm: /<form\b/i.test(page.text),
        scripts: scriptUrls(page.text, `${base}${path}`),
      });
    }
  }
  /** @type {Map<string, string | null>} */
  const bodies = new Map();
  /** @type {Map<string, string[]>} */
  const imports = new Map();
  const queue = [...new Set(pages.flatMap((page) => page.scripts))];
  for (const url of queue) {
    if (bodies.size >= MAX_SCRIPTS) break;
    const script = await getText(ctx.fetchImpl, url, {}, TIMEOUT_MS);
    bodies.set(url, script.status === 200 ? script.text : null);
    const next = script.status === 200 ? importedUrls(script.text, url) : [];
    imports.set(url, next);
    for (const target of next) if (!queue.includes(target)) queue.push(target);
  }
  const loaded = pages.map((page) => ({
    ...page,
    scripts: reachable(page.scripts, imports),
  }));
  return {
    host: new URL(base).hostname,
    checks: [
      ...parseSecurityHeaders(home.headers),
      ...judgeScripts(loaded, bodies),
      await probeRateLimit(ctx, base),
    ],
  };
}

/**
 * @param {import("./common.mjs").Context} ctx
 * @returns {Promise<import("./common.mjs").Collected>}
 */
export async function collect(ctx) {
  if (ctx.siteUrl === "") return { security: notMeasured("SITE_URL unset") };
  const result = await probe(ctx);
  return {
    security: "reason" in result ? notMeasured(result.reason) : measured(result),
  };
}

/**
 * @param {import("./common.mjs").Collected} collected
 * @returns {string[]}
 */
export function describeSecurity(collected) {
  const outcome = collected["security"];
  if (outcome === undefined || "notMeasured" in outcome) {
    return [`Not measured: security (${outcome?.notMeasured ?? "no result"})`];
  }
  const checks = recordsOf(field(outcome.value, "checks"));
  return [
    `host ${String(field(outcome.value, "host"))}`,
    ...checks.map((c) => `${String(c["status"])}  ${String(c["check"])}  ${String(c["detail"])}`),
  ];
}

await runCli(import.meta.url, collect, describeSecurity);
