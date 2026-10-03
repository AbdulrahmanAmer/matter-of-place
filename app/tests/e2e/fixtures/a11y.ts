import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";
import { z } from "zod";

// STANDARDS R47 (the plan's four tags plus wcag22aa, which R47 names).
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const BLOCKING = new Set(["serious", "critical"]);

const baselineSchema = z.array(
  z.object({
    route: z.string(),
    rule: z.string(),
    target: z.string(),
    reason: z.string().min(1),
    ticket: z.string().min(1),
  }),
);

const baseline = baselineSchema.parse(
  JSON.parse(readFileSync(new URL("../axe-baseline.json", import.meta.url), "utf8")),
);

const keyOf = (entry: { route: string; rule: string; target: string }) =>
  `${entry.route} | ${entry.rule} | ${entry.target}`;

/**
 * Scans the page and compares serious and critical violations with `axe-baseline.json` under the key `route`: a
 * violation not in the baseline is a new problem, a baseline entry that no longer occurs is a fixed problem that
 * must leave the list, so the file can only shrink.
 */
export async function runAxe(page: Page, route: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const found = results.violations
    .filter((violation) => violation.impact != null && BLOCKING.has(violation.impact))
    .flatMap((violation) =>
      violation.nodes.map((node) =>
        keyOf({ route, rule: violation.id, target: node.target.join(" ") }),
      ),
    );
  const accepted = baseline.filter((entry) => entry.route === route).map(keyOf);
  expect(
    found.filter((key) => !accepted.includes(key)),
    `axe: new violations on ${route}`,
  ).toEqual([]);
  expect(
    accepted.filter((key) => !found.includes(key)),
    `axe: baseline entries on ${route} that no longer occur (remove them from axe-baseline.json)`,
  ).toEqual([]);
}

/** `runAxe` for an admin screen or dialog, keyed by `label` (T-05): call it after each screen loads and each dialog opens. */
export function checkpoint(page: Page, label: string): Promise<void> {
  return runAxe(page, label);
}
