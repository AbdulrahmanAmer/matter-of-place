// The browser half of admin-shot.ts (Playwright's launch hangs under bun on Windows, so Chrome is driven from node).
// Draws `.tmp/shots/<scene>.html` at three widths, writes a PNG of each and measures the layout: nothing may leave its
// card, no card may cross another, and the page may not scroll sideways.
//   node scripts/admin-shot-measure.mjs <scene> <card selector> <cell selector> <out dir>
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const WIDTHS = [390, 820, 1440];
const root = resolve(import.meta.dirname, "..");
const [scene = "", card = "", cell = "", out = ".tmp/shots/out"] = process.argv.slice(2);

/**
 * The checks run inside the page. They are a string, not a function: this project's script types carry no DOM library
 * (P-1218, lib/email-shots-page.mjs).
 * @param {string} card
 * @param {string} cell
 * @param {number} width
 */
const inPage = (card, cell, width) => `(() => {
  const faults = [];
  const cards = [...document.querySelectorAll(${JSON.stringify(card)})];
  const cells = [...document.querySelectorAll(${JSON.stringify(cell)})];
  cards.forEach((box, index) => {
    const outer = box.getBoundingClientRect();
    for (const child of box.querySelectorAll("*")) {
      const rect = child.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      if (rect.right > outer.right + 0.5 || rect.left < outer.left - 0.5) {
        faults.push(\`${String(width)}px, card \${index}: <\${child.tagName.toLowerCase()} class="\${child.getAttribute("class") ?? ""}"> spans \${Math.round(rect.left)}..\${Math.round(rect.right)}, the card \${Math.round(outer.left)}..\${Math.round(outer.right)}\`);
      }
    }
  });
  cells.forEach((a, i) => {
    cells.slice(i + 1).forEach((b, j) => {
      const x = a.getBoundingClientRect();
      const y = b.getBoundingClientRect();
      const across = x.left < y.right - 0.5 && y.left < x.right - 0.5;
      const down = x.top < y.bottom - 0.5 && y.top < x.bottom - 0.5;
      if (across && down) faults.push(\`${String(width)}px, card \${i} crosses card \${i + 1 + j}\`);
    });
  });
  const page = document.documentElement;
  if (page.scrollWidth > page.clientWidth + 1) {
    faults.push(\`${String(width)}px, the page scrolls sideways: \${page.scrollWidth} > \${page.clientWidth}\`);
  }
  return faults;
})()`;

/**
 * @param {import("@playwright/test").Page} page
 * @param {number} width
 * @returns {Promise<string[]>} one line for each fault
 */
async function measure(page, width) {
  /** @type {unknown} */
  const found = await page.evaluate(inPage(card, cell, width));
  return Array.isArray(found) ? found.map(String) : [];
}

const browser = await chromium.launch({
  args: [
    "--disable-gpu",
    "--disable-gpu-rasterization",
    "--disable-accelerated-2d-canvas",
    "--use-gl=disabled",
    "--allow-file-access-from-files",
  ],
});
/** @type {string[]} */
const faults = [];
try {
  for (const width of WIDTHS) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto(pathToFileURL(join(root, ".tmp", "shots", `${scene}.html`)).href);
    await page.evaluate("document.fonts.ready.then(() => true)");
    await page.waitForTimeout(300);
    faults.push(...(await measure(page, width)));
    await page.screenshot({
      path: join(root, out, `${scene}-${String(width)}.png`),
      fullPage: true,
    });
    await page.close();
  }
} finally {
  await browser.close();
}
for (const fault of faults) console.log(`FAULT ${fault}`);
console.log(
  faults.length === 0
    ? `LAYOUT OK ${scene} at ${WIDTHS.join(", ")}`
    : `LAYOUT FAILED ${scene}: ${String(faults.length)} faults`,
);
process.exitCode = faults.length === 0 ? 0 : 1;
