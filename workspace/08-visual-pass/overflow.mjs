// usage: node overflow.mjs [base]  -- horizontal overflow + header collisions at odd widths
import { createRequire } from "node:module";
const require = createRequire("E:/Matter Of Place/launch/package.json");
const puppeteer = require("puppeteer-core");
const base = process.argv[2] || "http://127.0.0.1:8080";
const routes = ["/","/properties","/property/oak-hill-residence","/markets","/california","/california/guide","/california/bay-area","/stories","/stories/shade-as-a-material","/editorial-standard","/submit","/exposure","/about","/contact","/faq","/legal","/does-not-exist"];
const b = await puppeteer.launch({ executablePath: "C:/Users/DELL/.cache/puppeteer/chrome/win64-154.0.8037.57/chrome-win64/chrome.exe", headless: true });
let bad = 0;
for (const w of [320, 360, 768, 1024, 1281, 1366]) {
  const p = await b.newPage();
  await p.setViewport({ width: w, height: 900 });
  for (const r of routes) {
    await p.goto(base + r, { waitUntil: "networkidle0", timeout: 60000 }).catch(() => {});
    const m = await p.evaluate(() => {
      const dw = document.documentElement.clientWidth;
      const off = [];
      document.querySelectorAll("body *").forEach((e) => {
        const rc = e.getBoundingClientRect();
        if (rc.width > 0 && rc.right > dw + 1 && getComputedStyle(e).position !== "fixed") {
          let a = e, scroller = false;
          while ((a = a.parentElement)) { const o = getComputedStyle(a).overflowX; if (o === "auto" || o === "scroll" || o === "hidden") { scroller = true; break; } }
          if (!scroller) off.push(e.tagName + "." + String(e.className).slice(0, 30) + " r=" + Math.round(rc.right));
        }
      });
      const l = document.querySelector(".header-nav-left"), c = document.querySelector(".header-brand"), rr = document.querySelector(".header-nav-right");
      let coll = "";
      if (l && c && rr && getComputedStyle(l).display !== "none") {
        const a = l.getBoundingClientRect(), br = c.getBoundingClientRect(), z = rr.getBoundingClientRect();
        const lc = [...l.children].pop()?.getBoundingClientRect(), rc0 = rr.children[0]?.getBoundingClientRect();
        if (lc && lc.right > br.left - 8) coll += "left-nav touches brand ";
        if (rc0 && rc0.left < br.right + 8) coll += "right-nav touches brand ";
        if (z.right > dw) coll += "right-nav past edge";
      }
      return { sw: document.documentElement.scrollWidth, dw, off: off.slice(0, 4), coll };
    });
    if (m.sw > m.dw || m.off.length || m.coll) { bad++; console.log(w, r, m.sw > m.dw ? "SCROLL " + m.sw : "", JSON.stringify(m.off), m.coll); }
  }
  await p.close();
}
console.log("issues", bad);
await b.close();
