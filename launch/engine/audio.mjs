// Render a scene's sound design: opens <scene.html>?audio=1, awaits window.__audio (base64 float WAV rendered by
// OfflineAudioContext from the scene's cues.json), saves it. Usage: node launch/engine/audio.mjs <scene.html> [out.wav] [--query a=b&c=d]
import puppeteer from "puppeteer-core";
import { writeFileSync } from "node:fs";
import { resolve, join, relative, dirname } from "node:path";
import { serve, ROOT } from "./serve.mjs";
import { findChrome, CHROME_ARGS } from "./chrome.mjs";

const scene = resolve(process.argv[2]);
const queryAt = process.argv.indexOf("--query");
const query = queryAt >= 0 ? process.argv[queryAt + 1] : "";
const named = process.argv[3];
const out = resolve(named && !named.startsWith("--") ? named : join(dirname(scene), "audio.wav"));
const server = await serve();
const url = `${server.url}/${relative(ROOT, scene).split("\\").join("/").split("/").map(encodeURIComponent).join("/")}?${query ? `${query}&` : ""}audio=1`;
const browser = await puppeteer.launch({ executablePath: findChrome(), headless: true, protocolTimeout: 600000, args: CHROME_ARGS });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(url, { waitUntil: "load", timeout: 180000 });
await page.waitForFunction(() => window.__audio, { timeout: 60000 });
const t0 = Date.now();
const b64 = await page.evaluate(() => window.__audio);
if (errors.length) throw new Error(errors.join("\n"));
writeFileSync(out, Buffer.from(b64, "base64"));
console.log(`audio: ${out} (${(b64.length * 0.75 / 1e6).toFixed(1)} MB, ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
await browser.close();
await server.close();
