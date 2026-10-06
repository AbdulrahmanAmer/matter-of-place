// Shared Chrome helpers for capture, audio and product scripts.
import { existsSync, readdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

export function findChrome() {
  const fromEnv = process.env.CHROME_PATH;
  if (fromEnv) {
    if (!existsSync(fromEnv)) throw new Error("CHROME_PATH not found: " + fromEnv);
    return fromEnv;
  }
  const root = "C:/Users/DELL/.cache/puppeteer/chrome";
  const preferred = join(root, "win64-154.0.8037.57/chrome-win64/chrome.exe");
  if (existsSync(preferred)) return preferred;
  for (const v of readdirSync(root).sort().reverse()) {
    const p = join(root, v, "chrome-win64/chrome.exe");
    if (existsSync(p)) return p;
  }
  throw new Error("No cached Chrome under " + root);
}

export const CHROME_ARGS = ["--hide-scrollbars", "--force-color-profile=srgb", "--font-render-hinting=none", "--force-device-scale-factor=1",
  "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows", "--autoplay-policy=no-user-gesture-required",
  "--disable-gpu", "--disable-gpu-rasterization", "--disable-accelerated-2d-canvas", "--use-gl=disabled"];

// The E: drive sometimes refuses an open() for a moment (errno -4094 UNKNOWN); retry.
export async function writeRetry(path, data) {
  for (let i = 0; ; i++) {
    try { return await writeFile(path, data); } catch (e) { if (i >= 8) throw e; await new Promise((r) => setTimeout(r, 150 * (i + 1))); }
  }
}
