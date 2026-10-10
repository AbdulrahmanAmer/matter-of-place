import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

// Reads the `lhr-*.json` reports `lhci collect` writes (B13 step 8) and prints one `warn` line per page for each
// tighter target missed. Lighthouse CI takes one level per audit, so the hard limits stay `error` assertions in
// `lighthouserc.json` and these targets live here. Per page the three runs are reduced to their median, except the
// hero weight and the font count, which take the largest run. Exit 1 only when a report shows a request to Google
// Tag Manager or Google Analytics: the lab run never consents (invariant 9).
// The folder may hold the reports itself or in its immediate subfolders: `scripts/lhci-pages.mjs` keeps each page's
// reports in `.lighthouseci-pages/<n>-<slug>/` (ruling H76a). Both are read; a page's runs group by their final url.
// usage: node scripts/perf-targets.mjs [.lighthouseci]  (the CI step passes .lighthouseci-pages)

const TARGETS = { lcpMs: 2000, cls: 0.02, tbtMs: 150, heroBytes: 180 * 1024, fonts: 2 };
const ANALYTICS_HOSTS = ["googletagmanager.com", "google-analytics.com"];
const HERO_VARIANT = /\/media\/v\/.+\/hero\.webp$/;

const metric = z.object({ numericValue: z.number() });
const report = z.object({
  finalDisplayedUrl: z.string(),
  audits: z.object({
    "largest-contentful-paint": metric,
    "cumulative-layout-shift": metric,
    "total-blocking-time": metric,
    "network-requests": z.object({
      details: z.object({
        items: z.array(
          z.object({
            url: z.string(),
            resourceType: z.string().optional(),
            transferSize: z.number().optional(),
          }),
        ),
      }),
    }),
  }),
});

/**
 * @param {number[]} values
 * @returns {number}
 */
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

/**
 * @param {string} url
 * @returns {boolean}
 */
function isAnalytics(url) {
  const { hostname } = new URL(url);
  return ANALYTICS_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`));
}

/**
 * The `lhr-*.json` files directly in `dir` and in its immediate subfolders.
 * @param {string} dir
 * @returns {string[]} the paths
 */
function reportFiles(dir) {
  const isReport = (/** @type {string} */ name) => /^lhr-.*\.json$/.test(name);
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (!entry.isDirectory()) return isReport(entry.name) ? [join(dir, entry.name)] : [];
    return readdirSync(join(dir, entry.name))
      .filter(isReport)
      .map((name) => join(dir, entry.name, name));
  });
}

/**
 * The `warn` lines and the analytics requests of every report in `dir` and its immediate subfolders. Throws when
 * there is none.
 * @param {string} dir
 * @returns {{ warnings: string[], analytics: string[] }}
 */
export function measure(dir) {
  const files = reportFiles(dir);
  if (files.length === 0) throw new Error(`no lhr-*.json report in ${dir}`);
  /** @type {Map<string, z.infer<typeof report>[]>} */
  const pages = new Map();
  for (const file of files) {
    const parsed = report.parse(JSON.parse(readFileSync(file, "utf8")));
    pages.set(parsed.finalDisplayedUrl, [...(pages.get(parsed.finalDisplayedUrl) ?? []), parsed]);
  }

  /** @type {string[]} */
  const warnings = [];
  /** @type {string[]} */
  const analytics = [];
  for (const [url, runs] of pages) {
    const requests = runs.flatMap((run) => run.audits["network-requests"].details.items);
    for (const request of requests) {
      if (isAnalytics(request.url)) analytics.push(`${url} requested ${request.url}`);
    }
    const lcp = median(runs.map((run) => run.audits["largest-contentful-paint"].numericValue));
    const cls = median(runs.map((run) => run.audits["cumulative-layout-shift"].numericValue));
    const tbt = median(runs.map((run) => run.audits["total-blocking-time"].numericValue));
    const hero = Math.max(
      0,
      ...requests
        .filter((r) => HERO_VARIANT.test(new URL(r.url).pathname))
        .map((r) => r.transferSize ?? 0),
    );
    const fonts = Math.max(
      ...runs.map(
        (run) =>
          new Set(
            run.audits["network-requests"].details.items
              .filter((item) => item.resourceType?.toLowerCase() === "font")
              .map((item) => item.url),
          ).size,
      ),
    );
    const missed = [
      [
        lcp > TARGETS.lcpMs,
        `LCP ${String(Math.round(lcp))} ms, target ${String(TARGETS.lcpMs)} ms`,
      ],
      [cls > TARGETS.cls, `CLS ${cls.toFixed(3)}, target ${String(TARGETS.cls)}`],
      [
        tbt > TARGETS.tbtMs,
        `TBT ${String(Math.round(tbt))} ms, target ${String(TARGETS.tbtMs)} ms`,
      ],
      [
        hero > TARGETS.heroBytes,
        `hero image ${String(Math.round(hero / 1024))} KB, target ${String(TARGETS.heroBytes / 1024)} KB`,
      ],
      [fonts > TARGETS.fonts, `${String(fonts)} font files, target ${String(TARGETS.fonts)}`],
    ];
    for (const [over, text] of missed) if (over) warnings.push(`warn ${url} ${String(text)}`);
  }
  return { warnings, analytics: [...new Set(analytics)] };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const { warnings, analytics } = measure(process.argv[2] ?? ".lighthouseci");
    for (const line of warnings) console.log(line);
    for (const line of analytics) console.log(`error ${line}`);
    process.exitCode = analytics.length === 0 ? 0 : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : "failed");
    process.exitCode = 64;
  }
}
