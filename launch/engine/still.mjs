// Stills from a page: exact viewport, fonts and images settled, PNG out.
// Usage: node launch/engine/still.mjs <page.html> <width> <height> <out.png>
//        node launch/engine/still.mjs --frames <frames.json>
// With --frames (W8 item 1, a still post designed fresh for its request), the page is served from the repository root
// like a scene (serve.mjs), opened once per frame as <page>?frame=<name>&w=<width>&h=<height>&<query>, and a frame waits
// for `window.__post.ready` when the page sets it. frames.json is { page, out, report, query?, frames: [{ name, width,
// height }] }; each frame is written to <out>/<name>.png, and <report> receives, per frame, what the page drew with:
// the font families and the smallest size of its text, its visible text, the colours of its text, fills and borders,
// and every gradient, shadow, blur or backdrop filter in its computed styles (the house rules forbid them; the caller
// judges). Pixels a canvas draws are not in the report: the caller reads the page's source for those. The page was
// written by a model, so it reaches only a post's own files and nothing past this machine (post-guard.mjs): a refused
// request fails the frame, like any request that fails.
import puppeteer from "puppeteer-core";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { findChrome, CHROME_ARGS, writeRetry } from "./chrome.mjs";
import { guardPost, postChromeArgs, postPathAllowed } from "./post-guard.mjs";
import { serve, ROOT } from "./serve.mjs";

function watch(page) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  // Chrome asks for /favicon.ico by itself; a post's guard refuses it, and that is no fault of the page
  page.on("requestfailed", (r) => {
    if (!r.url().endsWith("/favicon.ico")) errors.push("request failed: " + r.url());
  });
  page.on("response", (r) => {
    if (r.status() >= 400 && !r.url().endsWith("/favicon.ico"))
      errors.push(`HTTP ${r.status()} ${r.url()}`);
  });
  return errors;
}

async function settle(page) {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => Promise.all([...document.images].map((i) => i.decode())));
  await page.evaluate(() => (window.__post && window.__post.ready) || null);
}

// What the frame drew with, read from the computed styles of every element that shows.
function audit() {
  const findings = [];
  const families = new Set();
  const colors = new Set();
  let smallest = Infinity;
  const name = (el) =>
    `<${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${el.classList.length ? `.${[...el.classList].join(".")}` : ""}>`;
  for (const el of document.querySelectorAll("body, body *")) {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) continue;
    for (const [prop, value] of [
      ["background-image", cs.backgroundImage],
      ["mask-image", cs.maskImage || cs.webkitMaskImage || "none"],
      ["border-image", cs.borderImageSource],
    ]) {
      if (/gradient\(/i.test(value || "")) findings.push(`${prop} gradient on ${name(el)}`);
    }
    if (cs.textShadow && cs.textShadow !== "none") findings.push(`text-shadow on ${name(el)}`);
    if (cs.boxShadow && cs.boxShadow !== "none") findings.push(`box-shadow on ${name(el)}`);
    if (cs.filter && /blur|drop-shadow/i.test(cs.filter))
      findings.push(`filter ${cs.filter} on ${name(el)}`);
    if (cs.backdropFilter && cs.backdropFilter !== "none")
      findings.push(`backdrop-filter on ${name(el)}`);
    const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim() !== "");
    if (ownText) {
      families.add(
        cs.fontFamily
          .split(",")[0]
          .trim()
          .replace(/^["']|["']$/g, ""),
      );
      smallest = Math.min(smallest, parseFloat(cs.fontSize));
      colors.add(cs.color);
    }
    colors.add(cs.backgroundColor);
    for (const side of ["Top", "Right", "Bottom", "Left"]) {
      if (parseFloat(cs[`border${side}Width`]) > 0 && cs[`border${side}Style`] !== "none")
        colors.add(cs[`border${side}Color`]);
    }
    if (el instanceof SVGElement && !(el instanceof SVGSVGElement)) {
      if (cs.fill && cs.fill !== "none" && !cs.fill.startsWith("url(")) colors.add(cs.fill);
      if (cs.stroke && cs.stroke !== "none" && !cs.stroke.startsWith("url(")) colors.add(cs.stroke);
      if (/^url\(/.test(cs.fill || "") || /^url\(/.test(cs.stroke || ""))
        findings.push(`paint server (a gradient or pattern) on ${name(el)}`);
    }
  }
  // a page that paints no background shows the browser's white
  const clear = (c) => /^rgba\(.*,\s*0\)$/.test(c) || c === "transparent";
  const paper = getComputedStyle(document.documentElement).backgroundColor;
  colors.add(
    clear(paper) && clear(getComputedStyle(document.body).backgroundColor)
      ? "rgb(255, 255, 255)"
      : paper,
  );
  return {
    findings,
    families: [...families],
    colors: [...colors],
    smallest_px: Number.isFinite(smallest) ? smallest : null,
    text: document.body.innerText,
  };
}

async function frames(specFile) {
  const spec = JSON.parse(readFileSync(specFile, "utf8"));
  const pagePath = resolve(spec.page);
  const rel = relative(ROOT, pagePath).split("\\").join("/");
  if (rel.startsWith("..") || !postPathAllowed(`/${rel}`))
    throw new Error("the page must be under app/.tmp/post/ of the repository: " + pagePath);
  mkdirSync(spec.out, { recursive: true });
  const server = await serve({ allow: postPathAllowed });
  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: true,
    args: [...CHROME_ARGS, ...postChromeArgs(server.url)],
  });
  const report = [];
  try {
    for (const frame of spec.frames) {
      const page = await browser.newPage();
      await guardPost(page, server.url);
      const errors = watch(page);
      await page.setViewport({ width: frame.width, height: frame.height, deviceScaleFactor: 1 });
      const query = new URLSearchParams({
        frame: frame.name,
        w: String(frame.width),
        h: String(frame.height),
      });
      const url = `${server.url}/${rel.split("/").map(encodeURIComponent).join("/")}?${query}${spec.query ? `&${spec.query}` : ""}`;
      await page.goto(url, { waitUntil: "load", timeout: 60000 });
      await settle(page);
      if (errors.length)
        throw new Error(`Page errors in frame ${frame.name}:\n` + errors.join("\n"));
      const found = await page.evaluate(audit);
      const out = join(spec.out, `${frame.name}.png`);
      await writeRetry(
        out,
        await page.screenshot({
          type: "png",
          clip: { x: 0, y: 0, width: frame.width, height: frame.height },
        }),
      );
      report.push({
        name: frame.name,
        file: out,
        width: frame.width,
        height: frame.height,
        ...found,
      });
      await page.close();
    }
  } finally {
    await browser.close();
    await server.close();
  }
  writeFileSync(spec.report, JSON.stringify(report, null, 1));
  console.log(spec.report);
}

async function one(pageArg, width, height, outArg) {
  const out = resolve(outArg);
  mkdirSync(dirname(out), { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: true,
    args: CHROME_ARGS,
  });
  try {
    const page = await browser.newPage();
    const errors = watch(page);
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(resolve(pageArg)).href, { waitUntil: "load", timeout: 60000 });
    await settle(page);
    if (errors.length) throw new Error("Page errors:\n" + errors.join("\n"));
    await writeRetry(
      out,
      await page.screenshot({ type: "png", clip: { x: 0, y: 0, width, height } }),
    );
    console.log(out);
  } finally {
    await browser.close();
  }
}

const args = process.argv.slice(2);
if (args[0] === "--frames" && args[1]) {
  await frames(args[1]);
} else {
  const [pageArg, widthArg, heightArg, outArg] = args;
  const width = Number(widthArg),
    height = Number(heightArg);
  if (!pageArg || !outArg || !(width > 0) || !(height > 0)) {
    console.error(
      "Usage: node launch/engine/still.mjs <page.html> <width> <height> <out.png> | --frames <frames.json>",
    );
    process.exit(2);
  }
  await one(pageArg, width, height, outArg);
}
