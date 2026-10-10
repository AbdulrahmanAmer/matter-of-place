// `bun run scripts/harden/check-headers.ts <baseUrl> [--cache]` (H1-04, H1-40). Reads the headers of `<baseUrl>/` and
// compares each security header as a whole string, and the Content-Security-Policy directive by directive as the
// exact source set of B17 invariant 1 (hashes aside). The expected values are written here, never imported from
// `src/server/lib/headers.ts`, so a change there cannot change what this check expects. `--cache` adds the
// Cache-Control table of architecture 13, one row per route kind. Prints `headers ok (<policy mode>)` and
// `cache-control ok (<n> rows)`, or one line per problem and exit 1.
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

const TIMEOUT_MS = 20_000;
const ENFORCING = "content-security-policy";
const REPORT_ONLY = "content-security-policy-report-only";
// The one database's origin (ruling H35), the target of the browser's signed upload PUT (B3).
const SUPABASE_ORIGIN = "https://hbokkmpgpqhrnemgsqra.supabase.co";
const TURNSTILE = "https://challenges.cloudflare.com";
const GA4_IMAGES = ["https://*.google-analytics.com", "https://*.googletagmanager.com"];
const GA4_CONNECT = [
  "https://*.google-analytics.com",
  "https://*.analytics.google.com",
  "https://*.googletagmanager.com",
];

const STATIC_HEADERS: Readonly<Record<string, string>> = {
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-frame-options": "DENY",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy":
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-site",
  "x-dns-prefetch-control": "off",
  "reporting-endpoints": 'csp="/api/public/csp-report"',
};

// B17 invariant 1 for a public page; `upgrade-insecure-requests` is sent only by an enforcing policy.
const POLICY: Readonly<Record<string, readonly string[]>> = {
  "default-src": ["'self'"],
  "script-src": ["'self'", TURNSTILE, "https://www.googletagmanager.com/gtag/js"],
  "style-src": ["'self'"],
  "img-src": ["'self'", "data:", ...GA4_IMAGES],
  "font-src": ["'self'"],
  "media-src": ["'self'"],
  "connect-src": ["'self'", TURNSTILE, ...GA4_CONNECT, SUPABASE_ORIGIN],
  "frame-src": [TURNSTILE],
  "frame-ancestors": ["'none'"],
  "base-uri": ["'self'"],
  "form-action": ["'self'"],
  "object-src": ["'none'"],
  "report-uri": ["/api/public/csp-report"],
  "report-to": ["csp"],
};
const HASHED = new Set(["script-src", "style-src"]);
const HASH = /^'sha256-[A-Za-z0-9+/]+=*'$/;

interface CacheRow {
  kind: string;
  path: string;
  init?: RequestInit;
  expected: string;
}

function cacheRows(asset: string): CacheRow[] {
  const inquiry = readFileSync(
    new URL("../../tests/fixtures/inquiry.json", import.meta.url),
    "utf8",
  );
  const json = { "content-type": "application/json" };
  return [
    { kind: "html page", path: "/", expected: "public, max-age=0, must-revalidate" },
    { kind: "catalog json", path: "/api/public/properties", expected: "public, max-age=60" },
    { kind: "document", path: "/sitemap.xml", expected: "public, max-age=3600" },
    { kind: "fingerprinted asset", path: asset, expected: "public, max-age=31536000, immutable" },
    { kind: "admin api", path: "/api/admin/me", expected: "no-store" },
    { kind: "admin page", path: "/admin", expected: "no-store" },
    {
      kind: "public write",
      path: "/api/public/inquiries",
      init: { method: "POST", headers: json, body: inquiry },
      expected: "no-store",
    },
    {
      kind: "hook",
      path: "/api/hooks/resend",
      init: { method: "POST", headers: json, body: "{}" },
      expected: "no-store",
    },
    { kind: "unknown api path", path: "/api/public/nothing-here", expected: "no-store" },
  ];
}

const get = (url: string, init: RequestInit = {}) =>
  fetch(url, { redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS), ...init });

function directives(policy: string): Map<string, string[]> {
  return new Map(
    policy
      .split(";")
      .map((part) => part.trim().split(/\s+/))
      .filter((tokens) => tokens[0] !== undefined && tokens[0] !== "")
      .map(([name = "", ...sources]) => [name.toLowerCase(), sources]),
  );
}

function policyProblems(policy: string, enforcing: boolean): string[] {
  const found = directives(policy);
  const expected = new Map<string, readonly string[]>(Object.entries(POLICY));
  if (enforcing) expected.set("upgrade-insecure-requests", []);
  const problems: string[] = [];
  for (const name of found.keys()) {
    if (!expected.has(name)) problems.push(`csp: unexpected directive ${name}`);
  }
  for (const [name, want] of expected) {
    const sources = found.get(name);
    if (sources === undefined) {
      problems.push(`csp: missing directive ${name}`);
      continue;
    }
    const hashes = sources.filter((source) => HASH.test(source));
    const rest = sources.filter((source) => !HASH.test(source));
    if (hashes.length > 0 && !HASHED.has(name))
      problems.push(`csp ${name}: a hash has no place here`);
    for (const source of rest.filter((source) => !want.includes(source))) {
      problems.push(`csp ${name}: unexpected ${source}`);
    }
    for (const source of want.filter((source) => !rest.includes(source))) {
      problems.push(`csp ${name}: missing ${source}`);
    }
  }
  if (!(found.get("script-src") ?? []).some((source) => HASH.test(source))) {
    problems.push("csp script-src: no sha256 hash for the page's inline scripts");
  }
  return problems;
}

function headerProblems(headers: Headers): { problems: string[]; mode: string } {
  const problems: string[] = [];
  for (const [name, want] of Object.entries(STATIC_HEADERS)) {
    const value = headers.get(name);
    if (value !== want)
      problems.push(`${name}: expected "${want}", found ${JSON.stringify(value)}`);
  }
  const enforced = headers.get(ENFORCING);
  const reported = headers.get(REPORT_ONLY);
  if ((enforced === null) === (reported === null)) {
    problems.push(`csp: expected exactly one of ${ENFORCING} and ${REPORT_ONLY}`);
    return { problems, mode: "none" };
  }
  problems.push(...policyProblems(enforced ?? reported ?? "", enforced !== null));
  return { problems, mode: enforced === null ? "report-only" : "enforced" };
}

async function cacheProblems(
  base: string,
  html: string,
): Promise<{ problems: string[]; rows: number }> {
  const asset = /\/assets\/[^"'\s>]+\.(?:js|css)/.exec(html)?.[0];
  if (asset === undefined)
    return { problems: ["cache-control: the page names no /assets/ file"], rows: 0 };
  const rows = cacheRows(asset);
  const problems: string[] = [];
  for (const row of rows) {
    const response = await get(`${base}${row.path}`, row.init);
    await response.body?.cancel();
    const found = response.headers.get("cache-control");
    if (found !== row.expected) {
      problems.push(
        `cache-control ${row.kind}: ${row.path} answered ${String(response.status)} with ${JSON.stringify(found)}, expected "${row.expected}"`,
      );
    }
  }
  return { problems, rows: rows.length };
}

async function main(): Promise<number> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { cache: { type: "boolean", default: false } },
  });
  const base = positionals[0]?.replace(/\/+$/, "");
  if (base === undefined || positionals.length !== 1 || !URL.canParse(base)) {
    console.error("usage: bun run scripts/harden/check-headers.ts <baseUrl> [--cache]");
    return 64;
  }
  const response = await get(`${base}/`);
  const html = await response.text();
  if (response.status !== 200) {
    console.error(`check-headers: ${base}/ answered ${String(response.status)}`);
    return 1;
  }
  const { problems, mode } = headerProblems(response.headers);
  let rows = 0;
  if (values.cache) {
    const cache = await cacheProblems(base, html);
    problems.push(...cache.problems);
    rows = cache.rows;
  }
  for (const problem of problems) console.error(`check-headers: ${problem}`);
  if (problems.length > 0) return 1;
  console.log(`headers ok (csp ${mode})`);
  if (values.cache) console.log(`cache-control ok (${String(rows)} rows)`);
  return 0;
}

process.exitCode = await main();
