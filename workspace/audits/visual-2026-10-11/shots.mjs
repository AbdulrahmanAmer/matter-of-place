// Visual pass renderer. Run from app/: `node ../workspace/audits/visual-2026-10-11/shots.mjs <before|after> [baseUrl]`.
// Writes <label>-<route>-<phone|desktop>-<top|full>.png and measures.<label>.json (overflow, small tap targets).
// The dev server must run without SUPABASE_* in its environment so it serves the illustrative adapter (G-901).
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(join(process.cwd(), "package.json"));
const { chromium } = require("@playwright/test");

const auditDir = dirname(fileURLToPath(import.meta.url));
// Screenshots live where the layout check allows pictures (STANDARDS 1.2); the measures stay with this script.
const here = join(auditDir, "..", "..", "08-visual-pass", "pairs", "visual-2026-10-11");
const label = process.argv[2] ?? "after";
const base = process.argv[3] ?? "http://localhost:8858";
const routes = [
  "/",
  "/markets",
  "/california",
  "/new-york",
  "/florida",
  "/properties",
  "/submit",
  "/contact",
  "/place-notes",
  "/privacy-request",
  "/privacy",
  "/terms",
  "/cookies",
  "/accessibility",
  "/legal",
];
const sizes = {
  phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  desktop: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
};

const slug = (route) => (route === "/" ? "home" : route.slice(1));
const measures = [];
const browser = await chromium.launch();
for (const [size, options] of Object.entries(sizes)) {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  for (const route of routes) {
    await page.goto(base + route, { waitUntil: "networkidle" });
    await page.addStyleTag({ content: "*{animation:none!important;transition:none!important}" });
    await page.waitForTimeout(400);
    const name = `${label}-${slug(route)}-${size}`;
    await page.screenshot({ path: join(here, `${name}-top.png`) });
    await page.screenshot({ path: join(here, `${name}-full.png`), fullPage: true });
    const found = await page.evaluate(() => {
      const wide = document.documentElement.scrollWidth - window.innerWidth;
      const small = [];
      for (const el of document.querySelectorAll("a, button, input, select, textarea, summary")) {
        const box = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        if (box.width === 0 || box.height === 0 || style.visibility === "hidden") continue;
        if (el.closest("[hidden], .sr-only")) continue;
        if (box.height < 44 || box.width < 44) {
          small.push({
            tag: el.tagName.toLowerCase(),
            text: (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 30),
            w: Math.round(box.width),
            h: Math.round(box.height),
          });
        }
      }
      return { overflow: wide, small };
    });
    measures.push({ route, size, ...found });
  }
  // Header states: phone menu open, and focus ring on the first nav control.
  await page.goto(base + "/contact", { waitUntil: "networkidle" });
  if (size === "phone") {
    await page.click(".header-toggle");
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(here, `${label}-menu-open-phone.png`) });
  }
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.screenshot({ path: join(here, `${label}-focus-${size}.png`), clip: { x: 0, y: 0, width: options.viewport.width, height: 140 } });
  await context.close();
}
await browser.close();
writeFileSync(join(auditDir, `measures.${label}.json`), JSON.stringify(measures, null, 1));
for (const m of measures) console.log(m.size, m.route, "overflow", m.overflow, "small", m.small.length);
