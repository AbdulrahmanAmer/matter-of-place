// usage: node states.mjs <outdir> [base]  -- viewport-sized shots of interactive states (fixed elements render correctly)
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
const require = createRequire("E:/Matter Of Place/launch/package.json");
const puppeteer = require("puppeteer-core");
const out = process.argv[2];
const base = process.argv[3] || "http://127.0.0.1:8080";
mkdirSync(out, { recursive: true });
const b = await puppeteer.launch({ executablePath: "C:/Users/DELL/.cache/puppeteer/chrome/win64-154.0.8037.57/chrome-win64/chrome.exe", headless: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function open(p, url) {
  await p.goto(base + url, { waitUntil: "networkidle0", timeout: 60000 }).catch(() => {});
  await wait(500);
}
const clickText = (p, sel, text) =>
  p.evaluate((sel, text) => {
    const el = [...document.querySelectorAll(sel)].find((e) => e.textContent.toLowerCase().includes(text.toLowerCase()));
    if (el) { el.click(); return true; }
    return false;
  }, sel, text);
const clickLabel = (p, label) => p.evaluate((l) => { const e = document.querySelector(`[aria-label="${l}"]`); if (e) e.click(); return !!e; }, label);
for (const [w, h, tag] of [[1440, 900, "d"], [390, 844, "m"]]) {
  const p = await b.newPage();
  await p.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  const shot = (n) => p.screenshot({ path: `${out}/${tag}-${n}.png` });
  // header at scroll
  await open(p, "/");
  await shot("home-top");
  await p.evaluate(() => window.scrollTo(0, 1100)); await wait(500); await shot("home-scrolled");
  // search overlay
  await open(p, "/");
  const s = await clickLabel(p, "Search properties"); await wait(400); await shot("search-overlay"); console.log(tag, "search", s);
  // menu panel (phone)
  if (tag === "m") { await open(p, "/"); const m = await clickLabel(p, "Open menu"); await wait(400); await shot("menu-panel"); console.log(tag, "menu", m); }
  // property viewport + dialog + concierge
  await open(p, "/property/oak-hill-residence");
  await shot("property-top");
  await p.evaluate(() => document.getElementById("dossier")?.scrollIntoView()); await wait(500); await shot("property-dossier");
  await p.evaluate(() => window.scrollTo(0, 0));
  if (tag === "d") { await clickText(p, "button", "Ask Matter of Place"); await wait(400); await shot("concierge"); }
  else { await clickText(p, ".sticky-actions button", "Ask"); await wait(400); await shot("concierge"); }
  await open(p, "/property/oak-hill-residence");
  if (tag === "m") await clickText(p, ".sticky-actions button", "Request"); else { await p.evaluate(() => document.querySelector(".representation-section")?.scrollIntoView()); await wait(300); await clickText(p, "button", "Request a private showing"); }
  await wait(500); await shot("inquiry-dialog");
  // filter bar open
  await open(p, "/properties");
  await p.evaluate(() => document.querySelector("#all-places, .collection")?.scrollIntoView()); await wait(300);
  await clickText(p, "button", "Filter"); await wait(400); await shot("filter-open");
  // focus states via keyboard
  await open(p, "/submit");
  await p.keyboard.press("Tab"); await p.keyboard.press("Tab"); await p.keyboard.press("Tab"); await wait(200); await shot("focus-header");
  await p.evaluate(() => document.querySelector(".field input")?.focus()); await wait(200);
  await p.evaluate(() => window.scrollTo(0, 300)); await wait(200); await shot("focus-field");
  // stories bottom (newsletter)
  await open(p, "/stories");
  await p.evaluate(() => document.querySelector(".newsletter")?.scrollIntoView({ block: "center" })); await wait(400); await shot("newsletter");
  // newsletter error state
  await clickText(p, ".newsletter-form button", ""); await wait(400); await shot("newsletter-submit");
  // contact form validation
  await open(p, "/contact");
  await clickText(p, "button[type=submit]", "Send"); await wait(400);
  await p.evaluate(() => window.scrollTo(0, 340)); await wait(200); await shot("contact-submit");
  // hover: property card
  if (tag === "d") { await open(p, "/properties"); await p.evaluate(() => window.scrollTo(0, 1100)); await wait(300); const c = await p.$(".property-card"); if (c) { await c.hover(); await wait(700); await shot("card-hover"); } }
  await p.close();
}
await b.close();
console.log("done");
