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

/** How long a scan waits for the page's own animations to end (ruling H72). */
export const SETTLE_CAP_MS = 5000;

/**
 * Waits until every animation and transition on the page that ends has ended, then answers true; answers false
 * when `capMs` runs out first. Animations that loop for ever (a skeleton's breathing, a scroll cue) and paused ones
 * are not awaited, they never finish (P-1920). An animation started while waiting is awaited too. Axe computes a
 * colour against the opacity the element has at that moment, so a scan taken while a dialog fades in sees text
 * on a half-faded ground: a ratio of 1.01 on CI, where the same screen passes on a laptop after the fade (ruling H72).
 */
export function settleAnimations(page: Page, capMs: number = SETTLE_CAP_MS): Promise<boolean> {
  return page.evaluate(async (cap) => {
    const deadline = performance.now() + cap;
    for (;;) {
      const running = document.getAnimations().filter((animation) => {
        const timing = animation.effect?.getComputedTiming();
        return (
          animation.playState === "running" &&
          timing !== undefined &&
          Number.isFinite(timing.endTime)
        );
      });
      if (running.length === 0) return true;
      const left = deadline - performance.now();
      if (left <= 0) return false;
      const ended = Promise.all(
        running.map((animation) => animation.finished.catch(() => undefined)),
      );
      await Promise.race([ended, new Promise((resolve) => setTimeout(resolve, left))]);
    }
  }, capMs);
}

/**
 * Scans the page and compares serious and critical violations with `axe-baseline.json` under the key `route`: a
 * violation not in the baseline is a new problem, a baseline entry that no longer occurs is a fixed problem that
 * must leave the list, so the file can only shrink. It scans after the page's animations have ended (ruling H72).
 * `exclude` names what axe cannot enter, such as the sandboxed mail preview of screen 13 (P-2412).
 */
export async function runAxe(
  page: Page,
  route: string,
  exclude: readonly string[] = [],
): Promise<void> {
  const settled = await settleAnimations(page);
  const builder = new AxeBuilder({ page }).withTags(TAGS);
  for (const selector of exclude) builder.exclude(selector);
  const results = await builder.analyze();
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
    `axe: new violations on ${route}${settled ? "" : ` (animations were still running after ${SETTLE_CAP_MS.toString()} ms, so a colour may be read mid-fade)`}`,
  ).toEqual([]);
  expect(
    accepted.filter((key) => !found.includes(key)),
    `axe: baseline entries on ${route} that no longer occur (remove them from axe-baseline.json)`,
  ).toEqual([]);
}

/** `runAxe` for an admin screen or dialog, keyed by `label` (T-05): call it after each screen loads and each dialog opens. */
export function checkpoint(
  page: Page,
  label: string,
  exclude: readonly string[] = [],
): Promise<void> {
  return runAxe(page, label, exclude);
}
