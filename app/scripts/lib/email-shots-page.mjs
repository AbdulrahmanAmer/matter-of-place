// The browser half of `bun run email:shots` (B5 step 9). It is its own file, run by Node, because Playwright cannot
// start a browser from Bun on this machine: under Bun 1.3.13 `chromium.launch()` never returns and `connectOverCDP`
// times out, while the same call under Node returns at once. Usage: node email-shots-page.mjs <key>...
// For each key it opens out/email-<key>.html at 375 px and at 600 px, requires no sideways scroll at either width, saves
// the full page at 600 px as out/email-<key>.png and prints `ok <key> 600x<height>`. It stops with exit 1 on the first
// overflow.
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";

const WIDE = 600;
const NARROW = 375;
const VIEW_HEIGHT = 900;
const ART_PREFIX = "https://matterofplace.com/email/";

/**
 * Sets the page to `width` and returns how wide its content is and how tall the whole page is.
 * @param {import("@playwright/test").Page} page
 * @param {number} width
 */
async function measure(page, width) {
  await page.setViewportSize({ width, height: VIEW_HEIGHT });
  // A string, not a function: this project's script types carry no DOM library.
  return /** @type {{ scrollWidth: number, height: number }} */ (
    await page.evaluate(
      "({ scrollWidth: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight })",
    )
  );
}

/**
 * @param {string} key
 * @param {number} scrollWidth
 * @param {number} width
 */
function assertFits(key, scrollWidth, width) {
  if (scrollWidth > width) {
    throw new Error(`${key}: scrollWidth ${String(scrollWidth)} at ${String(width)} px`);
  }
}

const keys = process.argv.slice(2);
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  // The email's artwork (masthead, ornament, emblem) is drawn from the site's own address, which not every machine
  // can reach: serve the files the site serves, so the picture shows what a reader sees. Any other outside request
  // (a sample property photograph) is refused, so a page never waits on the network (PR 328: one did, for 30 s).
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith(ART_PREFIX)) {
      const name = url.slice(ART_PREFIX.length).split(/[?#]/)[0] ?? "";
      return route.fulfill({
        body: readFileSync(new URL(`../../public/email/${name}`, import.meta.url)),
        contentType: "image/png",
      });
    }
    return url.startsWith("data:") ? route.continue() : route.abort();
  });
  for (const key of keys) {
    await page.setContent(readFileSync(`out/email-${key}.html`, "utf8"), { waitUntil: "load" });
    const wide = await measure(page, WIDE);
    assertFits(key, wide.scrollWidth, WIDE);
    await page.screenshot({ path: `out/email-${key}.png`, fullPage: true });
    assertFits(key, (await measure(page, NARROW)).scrollWidth, NARROW);
    console.log(`ok ${key} ${String(WIDE)}x${String(wide.height)}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await browser.close();
}
