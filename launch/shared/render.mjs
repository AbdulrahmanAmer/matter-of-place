// Frame-by-frame capture of a scene.html with headless Chrome.
// Usage: node shared/render.mjs <sceneDir> [--workers 4] [--only 0,450,900] [--fps 30]
// Writes <sceneDir>/frames/%05d.png. --only renders just those frame numbers (for review stills).
import puppeteer from "puppeteer-core";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const sceneDir = resolve(args[0]);
const opt = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
const fps = parseInt(opt("fps", "30"), 10);
const workers = parseInt(opt("workers", "4"), 10);
const only = opt("only", null)?.split(",").map(Number);

function findChrome() {
  const root = "C:/Users/DELL/.cache/puppeteer/chrome";
  const preferred = join(root, "win64-154.0.8037.57/chrome-win64/chrome.exe");
  if (existsSync(preferred)) return preferred;
  for (const v of readdirSync(root).sort().reverse()) {
    const p = join(root, v, "chrome-win64/chrome.exe");
    if (existsSync(p)) return p;
  }
  throw new Error("No cached Chrome found under " + root);
}

// The E: drive sometimes refuses an open() for a moment (errno -4094 UNKNOWN); retry a few times.
async function writeRetry(path, data) {
  for (let i = 0; ; i++) {
    try {
      return await writeFile(path, data);
    } catch (e) {
      if (i >= 8) throw e;
      await new Promise((r) => setTimeout(r, 150 * (i + 1)));
    }
  }
}

const framesDir = join(sceneDir, "frames");
if (!only) rmSync(framesDir, { recursive: true, force: true });
mkdirSync(framesDir, { recursive: true });

// One browser process per worker: tabs sharing a headless browser stop painting in the
// background and captureScreenshot hangs.
const chrome = findChrome();
const browsers = [];
const launch = async () => {
  const b = await puppeteer.launch({
    executablePath: chrome,
    headless: true,
    protocolTimeout: 180000,
    args: ["--allow-file-access-from-files", "--hide-scrollbars", "--force-color-profile=srgb", "--font-render-hinting=none",
      "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows"],
  });
  browsers.push(b);
  return b;
};
const url = pathToFileURL(join(sceneDir, "scene.html")).href;

async function openPage() {
  const page = await (await launch()).newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  await page.goto(url, { waitUntil: "networkidle0", timeout: 120000 });
  await page.evaluate(() => window.__ready);
  if (errors.length) throw new Error("Scene errors:\n" + errors.join("\n"));
  return page;
}

const first = await openPage();
const durationMs = await first.evaluate(() => window.__duration);
const total = Math.round((durationMs / 1000) * fps);
const list = only ?? Array.from({ length: total }, (_, i) => i);
console.log(`scene ${sceneDir}\nduration ${durationMs / 1000}s, ${total} frames, rendering ${list.length} with ${workers} workers`);

const pages = [first];
for (let i = 1; i < Math.min(workers, list.length); i++) pages.push(await openPage());

const t0 = Date.now();
let done = 0;
await Promise.all(
  pages.map(async (page, w) => {
    for (let k = w; k < list.length; k += pages.length) {
      const f = list[k];
      await page.evaluate((ms) => window.__seek(ms), (f * 1000) / fps);
      const png = await page.screenshot({ type: "png" });
      await writeRetry(join(framesDir, String(f).padStart(5, "0") + ".png"), png);
      if (++done % 300 === 0) console.log(`${done}/${list.length} frames, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    }
  }),
);
await Promise.all(browsers.map((b) => b.close()));
console.log(`done: ${done} frames in ${((Date.now() - t0) / 1000).toFixed(0)}s -> ${framesDir}`);
