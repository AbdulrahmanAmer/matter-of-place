import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { SCRIPT_BUDGET_BYTES } from "../../scripts/bundle-check.mjs";
import { lighthouseRoutes } from "../e2e/fixtures/routes";

// GQ-01, invariant 11: `budget.json` holds the limits, `lighthouserc.json` may assert no looser one, and the six pages
// are listed once. Ruling H61: until H1 tunes the pages, LCP and script size are asserted at warn, the rest at
// error; H1 empties WARN_UNTIL_H1.

const read = (file: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../${file}`, import.meta.url), "utf8"));

const budget = z
  .object({
    lcpMs: z.number(),
    cls: z.number(),
    scriptBytes: z.number(),
    documentBytes: z.number(),
    cpuMs: z.object({ p50: z.number() }),
    paths: z.array(z.string()),
  })
  .parse(read("budget.json"));

const assertion = z.tuple([z.string(), z.object({ maxNumericValue: z.number() })]);
const rc = z
  .object({
    ci: z.object({
      collect: z.object({ numberOfRuns: z.number() }).passthrough(),
      assert: z.object({ assertions: z.record(z.string(), assertion) }),
    }),
  })
  .parse(read("lighthouserc.json")).ci;

const WARN_UNTIL_H1 = ["largest-contentful-paint", "resource-summary:script:size"];

const wanted = (audit: string): string => (WARN_UNTIL_H1.includes(audit) ? "warn" : "error");

const LIMITS: [audit: string, budgeted: number][] = [
  ["largest-contentful-paint", budget.lcpMs],
  ["cumulative-layout-shift", budget.cls],
  ["resource-summary:script:size", budget.scriptBytes],
  ["resource-summary:document:size", budget.documentBytes],
];

describe("lighthouserc.json against budget.json", () => {
  it("asserts each limit at its level, and none looser than the budget", () => {
    const problems = LIMITS.flatMap(([audit, budgeted]) => {
      const entry = rc.assert.assertions[audit];
      if (entry === undefined) return [`${audit}: not asserted`];
      const [level, { maxNumericValue }] = entry;
      return [
        ...(level === wanted(audit) ? [] : [`${audit}: level ${level}, not ${wanted(audit)}`]),
        ...(maxNumericValue <= budgeted
          ? []
          : [
              `${audit}: lighthouserc.json asserts ${String(maxNumericValue)}, budget.json holds ${String(budgeted)}`,
            ]),
      ];
    });
    expect(problems).toEqual([]);
  });

  it("holds the script limit of the bundle check, and no URL of its own", () => {
    expect(budget.scriptBytes).toBe(SCRIPT_BUDGET_BYTES);
    expect(rc.collect).not.toHaveProperty("url");
    expect(rc.collect.numberOfRuns).toBe(3);
  });
});

describe("lighthouseRoutes", () => {
  it("resolves the six templates of budget.json in local mode", async () => {
    expect(budget.paths).toHaveLength(6);
    const routes = await lighthouseRoutes("local");
    expect(routes).toHaveLength(6);
    const fits = (template: string, path: string): boolean => {
      if (template === "property:first") return /^\/property\/[a-z0-9-]+$/.test(path);
      if (template === "market:first") return /^\/(california|florida|new-york)$/.test(path);
      return path === template;
    };
    expect(
      routes.filter((path, index) => !fits(budget.paths[index] ?? "", path)),
      "routes that do not resolve their template",
    ).toEqual([]);
  });
});
