// The photographs of `scripts/email-gallery.ts`: Node, not Bun, because Playwright cannot start a browser from Bun on
// this machine (see email-shots-page.mjs); the installed Edge draws every width, a phone's included (P-3513).
//   node scripts/lib/email-gallery-shots.mjs <pages dir> <shots dir> <key>...
// For each key: `<key>-on.html` at an 800 px reading pane (`-desktop.png`) and on a 375 px phone (`-phone.png`), and
// `<key>-off.html`, which loads no picture and no web font, at 800 px (`-imagesoff.png`). Each page is drawn as a
// reader who asked for reduced motion sees it (every line in place), refuses any sideways scroll, and is saved whole,
// as a palette PNG. Exit 1 on the first email wider than its screen.
import { chromium } from "@playwright/test";
import { pathToFileURL } from "node:url";
import sharp from "sharp";

const MODES = [
  { name: "desktop", page: "on", viewport: { width: 800, height: 900 }, scale: 1, mobile: false },
  { name: "phone", page: "on", viewport: { width: 375, height: 812 }, scale: 2, mobile: true },
  {
    name: "imagesoff",
    page: "off",
    viewport: { width: 800, height: 900 },
    scale: 1,
    mobile: false,
  },
];

const [pages, shots, ...keys] = process.argv.slice(2);
if (pages === undefined || shots === undefined) {
  console.error("usage: email-gallery-shots.mjs <pages dir> <shots dir> <key>...");
  process.exit(64);
}
const browser = await chromium.launch({ channel: "msedge" });
try {
  for (const mode of MODES) {
    const context = await browser.newContext({
      viewport: mode.viewport,
      deviceScaleFactor: mode.scale,
      isMobile: mode.mobile,
      hasTouch: mode.mobile,
      reducedMotion: "reduce",
      colorScheme: "light",
    });
    const page = await context.newPage();
    for (const key of keys) {
      await page.goto(pathToFileURL(`${pages}/${key}-${mode.page}.html`).href, {
        waitUntil: "load",
      });
      // Strings, not functions: this project's script types carry no DOM library.
      await page.evaluate("document.fonts.ready.then(() => true)");
      const width = /** @type {number} */ (
        await page.evaluate("document.documentElement.scrollWidth")
      );
      if (width > mode.viewport.width) {
        throw new Error(
          `${key}: scrollWidth ${String(width)} at ${String(mode.viewport.width)} px`,
        );
      }
      const png = await page.screenshot({ fullPage: true, animations: "disabled" });
      await sharp(png)
        .png({ palette: true, quality: 92, compressionLevel: 9 })
        .toFile(`${shots}/${key}-${mode.name}.png`);
    }
    console.log(`${mode.name}: ${String(keys.length)} emails, no sideways scroll`);
    await context.close();
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await browser.close();
}
