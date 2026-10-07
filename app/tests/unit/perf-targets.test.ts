// scripts/perf-targets.mjs (B13 step 8), read through temporary folders of Lighthouse reports.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { measure } from "../../scripts/perf-targets.mjs";

const PAGE = "https://example.test/";
const HERO = "https://example.test/media/v/owner/1-abcd1234/hero.webp";
const kb = (n: number) => n * 1024;

type Request = { url: string; resourceType?: string; transferSize?: number };

function report(
  values: { lcp?: number; cls?: number; tbt?: number; requests?: Request[]; url?: string } = {},
) {
  return {
    finalDisplayedUrl: values.url ?? PAGE,
    audits: {
      "largest-contentful-paint": { numericValue: values.lcp ?? 1500 },
      "cumulative-layout-shift": { numericValue: values.cls ?? 0 },
      "total-blocking-time": { numericValue: values.tbt ?? 50 },
      "network-requests": { details: { items: values.requests ?? [] } },
    },
  };
}

const folders: string[] = [];

function reports(...runs: ReturnType<typeof report>[]): string {
  const dir = mkdtempSync(join(tmpdir(), "lhci-"));
  folders.push(dir);
  runs.forEach((run, index) => {
    writeFileSync(join(dir, `lhr-${String(index)}.json`), JSON.stringify(run));
  });
  writeFileSync(join(dir, "manifest.json"), "[]");
  return dir;
}

afterEach(() => {
  for (const dir of folders.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("measure", () => {
  it("prints nothing for a page inside every target", () => {
    const dir = reports(
      report({ requests: [{ url: HERO, resourceType: "Image", transferSize: kb(120) }] }),
    );
    expect(measure(dir)).toEqual({ warnings: [], analytics: [] });
  });

  it("warns once per missed target, naming the page", () => {
    const requests = [
      { url: HERO, resourceType: "Image", transferSize: kb(300) },
      ...["a", "b", "c"].map((name) => ({
        url: `https://example.test/fonts/${name}.woff2`,
        resourceType: "Font",
      })),
    ];
    const { warnings } = measure(reports(report({ lcp: 2400, cls: 0.05, tbt: 200, requests })));
    expect(warnings).toEqual([
      `warn ${PAGE} LCP 2400 ms, target 2000 ms`,
      `warn ${PAGE} CLS 0.050, target 0.02`,
      `warn ${PAGE} TBT 200 ms, target 150 ms`,
      `warn ${PAGE} hero image 300 KB, target 180 KB`,
      `warn ${PAGE} 3 font files, target 2`,
    ]);
  });

  it("accepts two font files and counts a file once however often it was requested", () => {
    const font = { url: "https://example.test/fonts/a.woff2", resourceType: "Font" };
    const other = { url: "https://example.test/fonts/b.woff2", resourceType: "Font" };
    expect(measure(reports(report({ requests: [font, font, other] }))).warnings).toEqual([]);
  });

  it("reduces three runs of one page to their median", () => {
    const dir = reports(report({ lcp: 1900 }), report({ lcp: 5000 }), report({ lcp: 2100 }));
    expect(measure(dir).warnings).toEqual([`warn ${PAGE} LCP 2100 ms, target 2000 ms`]);
  });

  it("weighs only the hero variant, not another image under /media/", () => {
    const gallery = "https://example.test/media/v/owner/1-abcd1234/card.webp";
    const requests = [{ url: gallery, resourceType: "Image", transferSize: kb(400) }];
    expect(measure(reports(report({ requests }))).warnings).toEqual([]);
  });

  it("reports each page on its own line", () => {
    const dir = reports(
      report({ lcp: 3000, url: "https://example.test/a" }),
      report({ lcp: 3000, url: "https://example.test/b" }),
    );
    expect(measure(dir).warnings).toEqual([
      "warn https://example.test/a LCP 3000 ms, target 2000 ms",
      "warn https://example.test/b LCP 3000 ms, target 2000 ms",
    ]);
  });

  it("lists a request to Google Tag Manager or Google Analytics once", () => {
    const requests = [
      { url: "https://www.googletagmanager.com/gtag/js?id=G-X" },
      { url: "https://region1.google-analytics.com/g/collect" },
      { url: "https://example.test/notgoogletagmanager.com.js" },
    ];
    const { analytics } = measure(reports(report({ requests }), report({ requests })));
    expect(analytics).toEqual([
      `${PAGE} requested https://www.googletagmanager.com/gtag/js?id=G-X`,
      `${PAGE} requested https://region1.google-analytics.com/g/collect`,
    ]);
  });

  it("throws on a folder with no report", () => {
    const dir = mkdtempSync(join(tmpdir(), "lhci-"));
    folders.push(dir);
    mkdirSync(join(dir, "nested"));
    expect(() => measure(dir)).toThrow("no lhr-*.json report");
  });
});

describe("the command", () => {
  const run = (dir: string) =>
    spawnSync(process.execPath, ["scripts/perf-targets.mjs", dir], { encoding: "utf8" });

  it("exits 0 and prints a warn line for a missed target", () => {
    const result = run(reports(report({ lcp: 2400 })));
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`warn ${PAGE} LCP 2400 ms`);
  });

  it("exits 1 and prints an error line for a request to Google Analytics", () => {
    const requests = [{ url: "https://www.google-analytics.com/g/collect" }];
    const result = run(reports(report({ requests })));
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("error");
  });
});
