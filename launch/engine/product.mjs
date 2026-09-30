// Product capture: drive the real site in headless Chrome, one screenshot per film frame, deterministic.
// Usage: node launch/engine/product.mjs <shots.mjs> [--base http://127.0.0.1:8090] [--only home,grid]
//
// <shots.mjs> exports `shots`: [{ name, path, duration, setup?(page), frame: (t, ctx) => ({ cursor?: [x, y] }) }]
// `frame` runs INSIDE the page (serialized by puppeteer): it sets scroll, hover transforms, reveals for time t.
// Site CSS transitions and animations are disabled, so the only motion is the one we script, at the film's frame rate.
// Output: <shots dir>/product/<name>/0000.jpg ... and cursor.json (one [x, y] or null per frame).
import puppeteer from "puppeteer-core";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { findChrome, CHROME_ARGS, writeRetry } from "./chrome.mjs";

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const shotsFile = resolve(args[0]);
const base = opt("base", "http://127.0.0.1:8090");
const only = opt("only", null)?.split(",");
const fps = 30;
const { shots, css = "" } = await import(pathToFileURL(shotsFile).href);

// Film dressing: no motion of the site's own, no labels meant for the web preview, no prices, no floating buttons.
const FILM_CSS = `
*, *::before, *::after { transition: none !important; animation: none !important; caret-color: transparent !important; }
html { scroll-behavior: auto !important; }
.content-tag, .concierge-toggle, .concierge-panel, .sticky-actions, .scroll-cue { display: none !important; }
${css}`;

function dress() {
  // Hide anything that reads as a price; drop the word ILLUSTRATIVE from tag lines.
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const hide = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const s = n.nodeValue;
    if (/^\s*\$\s?[\d,.]+/.test(s)) hide.push(n.parentElement);
    else if (/illustrative/i.test(s)) n.nodeValue = s.replace(/\s*·\s*illustrative/gi, "").replace(/illustrative\s*/gi, "");
  }
  hide.forEach((el) => { el.style.visibility = "hidden"; });
}

const browser = await puppeteer.launch({ executablePath: findChrome(), headless: true, protocolTimeout: 300000, args: CHROME_ARGS });
for (const s of shots) {
  if (only && !only.includes(s.name)) continue;
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  await page.goto(base + s.path, { waitUntil: "networkidle0", timeout: 180000 });
  await page.addStyleTag({ content: FILM_CSS });
  await page.evaluate(dress);
  // Force every lazy image to load, then return to the top.
  await page.evaluate(async () => {
    for (let y = 0; y < document.documentElement.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); }
    window.scrollTo(0, 0);
    await Promise.all([...document.images].map((i) => (i.complete ? i.decode().catch(() => {}) : new Promise((r) => { i.onload = i.onerror = r; }))));
    await document.fonts.ready;
  });
  if (s.setup) await page.evaluate(s.setup);
  await page.mouse.move(-10, -10);
  const out = join(dirname(shotsFile), "product", s.name);
  mkdirSync(out, { recursive: true });
  const n = Math.round(s.duration * fps);
  const cursor = [];
  for (let i = 0; i < n; i++) {
    const r = await page.evaluate(s.frame, i / fps);
    await page.evaluate(() => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok))));
    cursor.push(r?.cursor ?? null);
    await writeRetry(join(out, String(i).padStart(4, "0") + ".jpg"), await page.screenshot({ type: "jpeg", quality: 94 }));
  }
  writeFileSync(join(out, "cursor.json"), JSON.stringify(cursor));
  console.log(`${s.name}: ${n} frames -> ${out}`);
  await page.close();
}
await browser.close();
