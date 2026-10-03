import { randomUUID } from "node:crypto";
import { contextFromArgs, isMain, measured, messageOf, notMeasured } from "./common.mjs";

// The cache probe (S52, architecture 13). It reads response headers only, sends no cookie and no
// `Cache-Control` request header, and puts no query string on the two measured passes (invariant 11).
const PAGES = ["/", "/properties", "/markets", "/stories", "/exposure", "/faq"];
const CATALOG = ["/api/public/markets", "/api/public/properties", "/api/public/stories"];
const NEVER_CACHED = ["/admin", "/api/admin/me", "/api/hooks/ops-health/probe"];
const TARGET = 0.95;
const TIMEOUT_MS = 30_000;

/**
 * @typedef {{
 *   path: string,
 *   pass: "first" | "second" | "variant" | "never",
 *   status: number,
 *   cache: string | null,
 *   version: string | null,
 *   cache_control: string | null,
 *   set_cookie: boolean,
 *   error: string | null,
 * }} ProbeRow
 * @typedef {{ check: string, status: "ok" | "red" | "not_measured", detail: string }} ProbeCheck
 */

/**
 * @param {import("./common.mjs").Context} ctx
 * @param {string} base
 * @param {string} path
 * @param {ProbeRow["pass"]} pass
 * @returns {Promise<ProbeRow>}
 */
async function probeOnce(ctx, base, path, pass) {
  const query = pass === "variant" ? `?probe=${randomUUID().slice(0, 8)}` : "";
  try {
    const response = await ctx.fetchImpl(`${base}${path}${query}`, {
      method: "GET",
      redirect: "manual",
      headers: { accept: "text/html,application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    await response.body?.cancel();
    return {
      path,
      pass,
      status: response.status,
      cache: response.headers.get("x-mop-cache"),
      version: response.headers.get("x-catalog-version"),
      cache_control: response.headers.get("cache-control"),
      set_cookie: response.headers.has("set-cookie"),
      error: null,
    };
  } catch (error) {
    return {
      path,
      pass,
      status: 0,
      cache: null,
      version: null,
      cache_control: null,
      set_cookie: false,
      error: messageOf(error),
    };
  }
}

/**
 * @param {number} part
 * @param {number} whole
 * @returns {number}
 */
const ratio = (part, whole) => (whole === 0 ? 0 : Number((part / whole).toFixed(4)));

/**
 * @param {boolean} passed
 * @returns {"ok" | "red"}
 */
const verdict = (passed) => (passed ? "ok" : "red");

/**
 * Judges the rows of one probe. A host on `workers.dev` has no Cache API, so the edge ratio is null
 * there (never 0) and only the header checks run.
 * @param {ProbeRow[]} rows
 * @param {string} host
 */
export function judge(rows, host) {
  const cached = rows.filter((row) => row.pass !== "never" && row.status > 0 && row.status < 400);
  const second = cached.filter((row) => row.pass === "second");
  const variants = cached.filter((row) => row.pass === "variant");
  const never = rows.filter((row) => row.pass === "never");
  // A never-cached route may answer 401, 404 or a redirect; only a page or catalog read that fails is a finding.
  const unreachable = rows.filter(
    (row) => row.status === 0 || (row.pass !== "never" && row.status >= 400),
  );
  const everHit = cached.some((row) => row.cache === "hit");
  /** @type {string | null} */
  let unmeasured = null;
  if (host.endsWith(".workers.dev")) unmeasured = "the Cache API does nothing on workers.dev";
  else if (!everHit) unmeasured = "no answer was a hit";
  const edgeHitRatio =
    unmeasured === null
      ? ratio(second.filter((row) => row.cache === "hit").length, second.length)
      : null;
  const versions = new Set(cached.flatMap((row) => (row.version === null ? [] : [row.version])));
  const variantsSameKey = unmeasured === null ? variants.every((row) => row.cache === "hit") : null;
  const neverOk = never.every((row) => row.cache_control?.trim().toLowerCase() === "no-store");
  const cookieOnCached = cached.some((row) => row.set_cookie);
  const stale = cached.filter((row) => row.cache === "stale").length;
  const present = ratio(cached.filter((row) => row.cache !== null).length, cached.length);

  /** @type {ProbeCheck[]} */
  const checks = [
    ...[...new Map(unreachable.map((row) => [row.path, row])).values()].map((row) => ({
      check: `reachable ${row.path}`,
      status: /** @type {const} */ ("red"),
      detail: row.error ?? `HTTP ${String(row.status)}`,
    })),
    edgeHitRatio === null
      ? {
          check: "edge_hit_ratio",
          status: "not_measured",
          detail: `Not measured: ${unmeasured ?? ""}`,
        }
      : {
          check: "edge_hit_ratio",
          status: edgeHitRatio >= TARGET ? "ok" : "red",
          detail: `${String(edgeHitRatio)} on the second pass, target ${String(TARGET)}`,
        },
    {
      check: "headers_present",
      status: present === 1 ? "ok" : "red",
      detail: `${String(present)} of probed responses carry x-mop-cache`,
    },
    {
      check: "version_stable",
      status: versions.size <= 1 ? "ok" : "red",
      detail: `x-catalog-version values: ${[...versions].join(", ") || "none"}`,
    },
    variantsSameKey === null
      ? { check: "query_variant_same_key", status: "not_measured", detail: "Not measured" }
      : {
          check: "query_variant_same_key",
          status: variantsSameKey ? "ok" : "red",
          detail: variantsSameKey
            ? "query variants answered from the same key"
            : "a query variant missed",
        },
    ...never.map((row) => ({
      check: `never_cached ${row.path}`,
      status: verdict(row.cache_control?.trim().toLowerCase() === "no-store"),
      detail: `Cache-Control: ${row.cache_control ?? "missing"}, expected exactly no-store`,
    })),
    {
      check: "set_cookie_on_cached",
      status: cookieOnCached ? "red" : "ok",
      detail: cookieOnCached
        ? "a cached page carries Set-Cookie"
        : "no cached page carries Set-Cookie",
    },
    {
      check: "stale",
      status: stale === 0 ? "ok" : "red",
      detail: `${String(stale)} stale answers`,
    },
  ];
  return {
    summary: {
      host,
      probed: rows.length,
      edge_hit_ratio: edgeHitRatio,
      edge_hit_reason: unmeasured,
      headers_present_ratio: present,
      version_stable: versions.size <= 1,
      query_variant_same_key: variantsSameKey,
      never_cached_ok: neverOk,
      set_cookie_on_cached: cookieOnCached,
      stale_count: stale,
    },
    checks,
  };
}

/**
 * Requests every public page and catalog read twice, a random query variant of each, and the
 * never-cached routes once.
 * @param {import("./common.mjs").Context} ctx
 * @returns {Promise<{ rows: ProbeRow[], summary: ReturnType<typeof judge>["summary"], checks: ProbeCheck[] }>}
 */
export async function probe(ctx) {
  const base = ctx.siteUrl.replace(/\/+$/, "");
  const cacheable = [...PAGES, ...CATALOG];
  /** @type {ProbeRow[]} */
  const rows = [];
  for (const [pass, paths] of /** @type {const} */ ([
    ["first", cacheable],
    ["second", cacheable],
    ["variant", cacheable],
    ["never", NEVER_CACHED],
  ])) {
    for (const path of paths) rows.push(await probeOnce(ctx, base, path, pass));
  }
  return { rows, ...judge(rows, new URL(base).hostname) };
}

/**
 * @param {import("./common.mjs").Context} ctx
 * @returns {Promise<import("./common.mjs").Collected>}
 */
export async function collect(ctx) {
  if (ctx.siteUrl === "") return { cache: notMeasured("SITE_URL unset") };
  const { summary, checks } = await probe(ctx);
  return { cache: measured({ ...summary, checks }) };
}

/**
 * @param {Awaited<ReturnType<typeof probe>>} result
 * @returns {string[]} one line per probed URL, one per check, then the edge ratio
 */
export function describeProbe(result) {
  return [
    ...result.rows.map(
      (row) =>
        `${row.path}  ${row.pass}  ${String(row.status)}  x-mop-cache ${row.cache ?? "-"}  x-catalog-version ${row.version ?? "-"}  cache-control ${row.cache_control ?? "-"}`,
    ),
    ...result.checks.map((check) => `${check.status}  ${check.check}  ${check.detail}`),
    `edge_hit_ratio: ${String(result.summary.edge_hit_ratio)}`,
  ];
}

if (isMain(import.meta.url)) {
  const lines = describeProbe(await probe(contextFromArgs()));
  process.stdout.write(`${lines.join("\n")}\n`);
}
