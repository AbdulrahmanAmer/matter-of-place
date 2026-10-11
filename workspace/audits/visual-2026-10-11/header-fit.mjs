// Prints the gap between the header nav groups and the brand at widths around the breakpoint. Run from app/.
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(join(process.cwd(), "package.json"));
const { chromium } = require("@playwright/test");
const base = process.argv[2] ?? "http://localhost:8858";
const browser = await chromium.launch();
for (const width of [1190, 1200, 1280, 1440]) {
  const page = await browser.newPage({ viewport: { width, height: 800 } });
  await page.goto(base + "/contact", { waitUntil: "networkidle" });
  const r = await page.evaluate(() => {
    const box = (s) => document.querySelector(s)?.getBoundingClientRect();
    const l = box(".header-nav-left");
    const rr = box(".header-nav-right");
    const b = box(".header-brand");
    const visible = l && l.width > 0;
    // Real content extent: the last link inside each nav.
    const lastLeft = [...document.querySelectorAll(".header-nav-left a")].at(-1)?.getBoundingClientRect();
    const firstRight = document.querySelector(".header-nav-right a")?.getBoundingClientRect();
    const rn = document.querySelector(".header-nav-right").getBoundingClientRect(); return { visible, brandCentreOffset: Math.round((b.left + b.right) / 2 - window.innerWidth / 2), rightNavLeft: Math.round(rn.left), brandRight: Math.round(b.right), leftNavRight: Math.round(l.right), brandLeft: Math.round(b.left) };
  });
  console.log(width, JSON.stringify(r));
  await page.close();
}
await browser.close();
