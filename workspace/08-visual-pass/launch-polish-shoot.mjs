// usage: node launch-polish-shoot.mjs <outdir> <prefix> [base]
// Home hero (viewport), full home page, footer, and the open mobile menu at 390, 1280, 1440.
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
const require = createRequire("E:/Matter Of Place/launch/package.json");
const puppeteer = require("puppeteer-core");
const [out, prefix, base = "http://localhost:8888"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const sizes = [
  [390, 844],
  [1280, 800],
  [1440, 900],
];
const b = await puppeteer.launch({
  executablePath: "C:/Users/DELL/.cache/puppeteer/chrome/win64-154.0.8037.57/chrome-win64/chrome.exe",
  headless: true,
});
for (const [w, h] of sizes) {
  const p = await b.newPage();
  await p.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  await p.goto(base + "/", { waitUntil: "networkidle0", timeout: 120000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1200));
  await p.screenshot({ path: `${out}/${prefix}-home-top-${w}.png` });
  await p.evaluate(async () => {
    const H = document.body.scrollHeight;
    for (let y = 0; y < H; y += 500) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 50));
    }
    window.scrollTo(0, document.body.scrollHeight);
    await new Promise((r) => setTimeout(r, 600));
  });
  await p.addStyleTag({ content: ".site-header,.skip-link{visibility:hidden!important}" });
  const foot = await p.$("footer.site-footer");
  await foot.screenshot({ path: `${out}/${prefix}-footer-${w}.png` });
  await p.addStyleTag({ content: ".site-header,.skip-link{visibility:visible!important}" });
  await p.evaluate(() => window.scrollTo(0, 0));
  await new Promise((r) => setTimeout(r, 500));
  const over = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const gap = await p.evaluate(() => {
    const r = (sel) => document.querySelector(sel)?.getBoundingClientRect();
    const brand = r(".header-brand");
    const first = document.querySelector(".header-nav-right a")?.getBoundingClientRect();
    const search = r(".header-nav-right .header-search");
    const small = [...document.querySelectorAll(".header-nav a,.header-search,.header-toggle,.header-search-mobile")]
      .map((e) => e.getBoundingClientRect()).filter((b) => b.width > 0 && b.height < 44).length;
    return { brandToRightNav: first && brand ? Math.round(first.left - brand.right) : null, rightEdgeSlack: search ? Math.round(innerWidth - search.right) : null, targetsUnder44: small, header: r(".site-header")?.height };
  });
  console.log(w, JSON.stringify(gap));
  console.log(w, "horizontal overflow px:", over);
  if (w === 390) {
    await p.click(".header-toggle");
    await new Promise((r) => setTimeout(r, 800));
    await p.screenshot({ path: `${out}/${prefix}-menu-${w}.png` });
  }
  await p.close();
}
await b.close();
