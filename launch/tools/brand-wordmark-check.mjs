#!/usr/bin/env node
/**
 * Compares the outlined wordmark with what Chrome draws from the site's own HTML and CSS.
 *   node launch/tools/brand-wordmark-check.mjs [outDir]     (default: the OS temp folder)
 * Prints the font Chrome used per glyph and the per-letter offsets, and writes a side by side PNG.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { wordmarkGeometry, wordmarkPath, CHROME } from "./brand-build.mjs";

const require = createRequire(import.meta.url);
const puppeteer = require("puppeteer-core");
const out = process.argv[2] || os.tmpdir();
const FONTS = "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500&family=Jost:wght@300;400;500;600&family=Urbanist:wght@300;500;700&family=Epilogue:wght@300;400&display=swap";
const css = `:root{--font-sans:"Jost",sans-serif}body{margin:0;background:#F5F2EB;color:#11110F}
.brand-horizontal,.brand-stacked{font-family:var(--font-sans);font-weight:300;letter-spacing:.24em;line-height:1.05;white-space:nowrap}
.brand-horizontal{font-size:15px}.brand-horizontal small{font-size:.58em;margin:0 .18em}
.brand-stacked{display:flex;align-items:center;flex-direction:column;gap:7px;font-size:29px;width:max-content}.brand-stacked small{font-size:11px}`;
const body = `<div style="padding:20px"><span class="brand-horizontal" id="h">MΛTTER <small>OF</small> PLΛCE</span></div>
<div style="padding:20px"><div class="brand-stacked" id="s"><span>MΛTTER</span><small>OF</small><span>PLΛCE</span></div></div>`;
const b = await puppeteer.launch({ executablePath: CHROME, headless: true });
const p = await b.newPage();
await p.setContent(`<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="${FONTS}"><style>${css}</style>${body}`, { waitUntil: "networkidle0" });
await p.evaluate(() => document.fonts.ready);
const cdp = await p.createCDPSession();
await cdp.send("DOM.enable"); await cdp.send("CSS.enable");
const { root } = await cdp.send("DOM.getDocument");
for (const sel of ["#h", "#s span:first-child", "#s span:last-child"]) {
  const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector: sel });
  console.log(sel, JSON.stringify((await cdp.send("CSS.getPlatformFontsForNode", { nodeId })).fonts.map((f) => `${f.familyName}/${f.postScriptName} x${f.glyphCount}`)));
}
// per-character left edges in Chrome (CSS px, relative to the element) for the main-size letters
const chrome = await p.evaluate(() => {
  const el = document.getElementById("h"), base = el.getBoundingClientRect().left, res = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n; (n = walker.nextNode()); ) {
    if (n.parentElement.tagName === "SMALL") continue;
    for (let i = 0; i < n.length; i++) { const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 1); res.push([n.data[i], r.getBoundingClientRect().left - base]); }
  }
  return res;
});
const geo = wordmarkGeometry(false, 150);
const mainMine = geo.pens.slice(0, 7).concat(geo.pens.slice(9)); // drop "OF"
console.log("letter  chrome_px  outlined_px  delta_px");
chrome.forEach(([ch, x], i) => { const m = mainMine[i].x / 10; console.log(`${ch === " " ? "_" : ch}       ${x.toFixed(2).padStart(8)}  ${m.toFixed(2).padStart(10)}  ${(m - x).toFixed(2).padStart(8)}`); });
// side by side image at 8x
const svgHtml = (st) => { const g = wordmarkGeometry(st, st ? 290 : 150); const dx = -g.box.x0, dy = -g.box.y0, w = g.box.x1 - g.box.x0, h = g.box.y1 - g.box.y0;
  const d = wordmarkPath(g, dx, dy);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w * 0.8}" height="${h * 0.8}" viewBox="0 0 ${w} ${h}"><path d="${d}" fill="#11110F"/></svg>`; };
await p.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
await p.evaluate(() => { document.body.style.zoom = 8; });
const hShot = await (await p.$("#h")).screenshot({ type: "png" });
fs.writeFileSync(path.join(out, "wordmark-chrome-horizontal.png"), hShot);
const pg2 = await b.newPage(); await pg2.setViewport({ width: 1600, height: 400 });
await pg2.setContent(`<body style="margin:0;background:#F5F2EB">${svgHtml(false)}</body>`);
fs.writeFileSync(path.join(out, "wordmark-outlined-horizontal.png"), await pg2.screenshot({ type: "png", clip: { x: 0, y: 0, width: 1600, height: 140 } }));
console.log("images:", path.join(out, "wordmark-chrome-horizontal.png"), path.join(out, "wordmark-outlined-horizontal.png"));
await b.close();
