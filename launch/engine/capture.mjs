// Frame capture for a scene that implements window.__film (see runtime/film.js).
// Usage:
//   node launch/engine/capture.mjs <scene.html> [--out frames] [--from 0 --to 76] [--workers 6] [--fps 30] [--w 1920 --h 1080] [--query a=b&c=d]
//   node launch/engine/capture.mjs <scene.html> --at 3.2,10.5,40 --out stills     (review stills, named by timecode)
// Frames are frames/%05d.png by absolute frame number. Resume-safe: existing non-empty frames are skipped.
import puppeteer from "puppeteer-core";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { resolve, join, relative } from "node:path";
import { serve, ROOT } from "./serve.mjs";
import { findChrome, CHROME_ARGS, writeRetry } from "./chrome.mjs";

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const scene = resolve(args[0]);
const fps = Number(opt("fps", 30));
const workers = Number(opt("workers", 6));
const out = resolve(opt("out", join(scene, "..", "frames")));
const at = opt("at", null)?.split(",").map(Number);
const width = Number(opt("w", 1920));
const height = Number(opt("h", 1080));
const query = opt("query", "");

mkdirSync(out, { recursive: true });
const server = await serve();
const url = `${server.url}/${relative(ROOT, scene).split("\\").join("/").split("/").map(encodeURIComponent).join("/")}${query ? `?${query}` : ""}`;
const chrome = findChrome();
const browsers = [];

async function openPage() {
  const b = await puppeteer.launch({ executablePath: chrome, headless: true, protocolTimeout: 300000, args: CHROME_ARGS });
  browsers.push(b);
  const page = await b.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on("response", (r) => { if (r.status() >= 400 && !r.url().endsWith("/favicon.ico")) errors.push(`HTTP ${r.status()} ${r.url()}`); });
  page.on("requestfailed", (r) => errors.push("request failed: " + r.url()));
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  await page.goto(url, { waitUntil: "load", timeout: 180000 });
  await page.waitForFunction(() => window.__film, { timeout: 60000 });
  await page.evaluate(() => window.__film.ready);
  if (errors.length) throw new Error("Scene errors:\n" + errors.join("\n"));
  return page;
}

const first = await openPage();
const durationMs = await first.evaluate(() => window.__film.duration);
const total = Math.round((durationMs / 1000) * fps);
let list;
if (at) list = at.map((s) => Math.min(total - 1, Math.round(s * fps)));
else {
  const f0 = Math.max(0, Math.floor(Number(opt("from", 0)) * fps));
  const f1 = Math.min(total, Math.ceil(Number(opt("to", durationMs / 1000)) * fps));
  list = [];
  for (let f = f0; f < f1; f++) list.push(f);
}
const name = (f) => (at ? `t${(f / fps).toFixed(2).padStart(6, "0")}.png` : String(f).padStart(5, "0") + ".png");
const todo = list.filter((f) => { const p = join(out, name(f)); return at || !existsSync(p) || statSync(p).size === 0; });
console.log(`scene ${url}\n${durationMs / 1000}s = ${total} frames; ${list.length} requested, ${todo.length} to render, ${workers} workers -> ${out}`);

const pages = [first];
for (let i = 1; i < Math.min(workers, todo.length); i++) pages.push(await openPage());

// Contiguous chunks per worker: image sequences stay warm and seeks move forward.
const chunk = Math.ceil(todo.length / pages.length);
const t0 = Date.now();
let done = 0;
await Promise.all(pages.map(async (page, w) => {
  for (const f of todo.slice(w * chunk, (w + 1) * chunk)) {
    await page.evaluate((ms) => window.__film.seek(ms), (f * 1000) / fps);
    const png = await page.screenshot({ type: "png", optimizeForSpeed: true });
    await writeRetry(join(out, name(f)), png);
    if (++done % 300 === 0) console.log(`${done}/${todo.length} frames, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
}));
await Promise.all(browsers.map((b) => b.close()));
await server.close();
console.log(`done: ${done} frames in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
