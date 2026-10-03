// One still from one static page: exact viewport, fonts and images settled, PNG out.
// Usage: node launch/engine/still.mjs <page.html> <width> <height> <out.png>
import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { findChrome, CHROME_ARGS, writeRetry } from "./chrome.mjs";

const [pageArg, widthArg, heightArg, outArg] = process.argv.slice(2);
const width = Number(widthArg), height = Number(heightArg);
if (!pageArg || !outArg || !(width > 0) || !(height > 0)) {
  console.error("Usage: node launch/engine/still.mjs <page.html> <width> <height> <out.png>");
  process.exit(2);
}
const out = resolve(outArg);
mkdirSync(dirname(out), { recursive: true });

const browser = await puppeteer.launch({ executablePath: findChrome(), headless: true, args: CHROME_ARGS });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("requestfailed", (r) => errors.push("request failed: " + r.url()));
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(resolve(pageArg)).href, { waitUntil: "load", timeout: 60000 });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => Promise.all([...document.images].map((i) => i.decode())));
  if (errors.length) throw new Error("Page errors:\n" + errors.join("\n"));
  await writeRetry(out, await page.screenshot({ type: "png", clip: { x: 0, y: 0, width, height } }));
  console.log(out);
} finally {
  await browser.close();
}
