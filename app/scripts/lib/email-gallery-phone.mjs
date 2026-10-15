// The phone half of `scripts/email-gallery.ts`: Node, not Bun, because Playwright cannot start a browser from Bun on
// this machine (see email-shots-page.mjs). Edge's command line cannot make a window narrower than a desktop one, so a
// phone is drawn here, in the installed Edge at a 390 px viewport.
//   node scripts/lib/email-gallery-phone.mjs <pages dir> <shots dir> <key>...
// For each key it opens <pages>/<key>-phone.html, refuses any sideways scroll, and saves the whole page with every
// motion finished as <shots>/<key>-phone.png. Exit 1 on the first email wider than the screen.
import { chromium } from "@playwright/test";
import { pathToFileURL } from "node:url";

const PHONE = { width: 390, height: 844 };

const [pages, shots, ...keys] = process.argv.slice(2);
if (pages === undefined || shots === undefined) {
  console.error("usage: email-gallery-phone.mjs <pages dir> <shots dir> <key>...");
  process.exit(64);
}
const browser = await chromium.launch({ channel: "msedge" });
try {
  const page = await browser.newPage({ viewport: PHONE });
  for (const key of keys) {
    await page.goto(pathToFileURL(`${pages}/${key}-phone.html`).href, { waitUntil: "load" });
    // A string, not a function: this project's script types carry no DOM library.
    const width = /** @type {number} */ (
      await page.evaluate("document.documentElement.scrollWidth")
    );
    if (width > PHONE.width)
      throw new Error(`${key}: scrollWidth ${String(width)} at ${String(PHONE.width)} px`);
    await page.screenshot({
      path: `${shots}/${key}-phone.png`,
      fullPage: true,
      animations: "disabled",
    });
    console.log(`phone ${key} ${String(PHONE.width)} px, no sideways scroll`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await browser.close();
}
