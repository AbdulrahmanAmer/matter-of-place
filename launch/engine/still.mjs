// Stills from a page: exact viewport, fonts and images settled, PNG out.
// Usage: node launch/engine/still.mjs <page.html> <width> <height> <out.png>
//        node launch/engine/still.mjs --frames <frames.json>
// With --frames (W8 item 1, a still post designed fresh for its request), the page is served from the repository root
// like a scene (serve.mjs), opened once per frame as <page>?frame=<name>&w=<width>&h=<height>&<query>, and a frame waits
// for `window.__post.ready` when the page sets it. frames.json is { page, out, report, query?, frames: [{ name, width,
// height }] }; each frame is written to <out>/<name>.png, and <report> receives, per frame, what the page drew with:
// the font families and the smallest size of its text, its visible text, the colours of its text, fills and borders,
// and every gradient, shadow, filter, blend mode or backdrop filter in its computed styles (the house rules forbid them; the caller
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
  const text = document.body.innerText;
  // A <use> draws a copy of its element that inherits from the use, not from where the element is kept (round 9). The
  // copy is put in the use's place for the reads below, under a <g> holding the use's computed paint: Chrome matches the
  // copy's own selectors (type, id, class) but no selector across the use, so its ids stay and the use's class does not.
  const byId = new Map();
  for (const el of document.querySelectorAll("[id]")) if (!byId.has(el.id)) byId.set(el.id, el);
  const copies = [];
  const drawnSymbols = new Set();
  // an HTML element named use draws nothing and has no href (round 10)
  let uses = [...document.querySelectorAll("use")].filter((el) => el instanceof SVGUseElement);
  for (const use of uses) {
    const href = use.href.baseVal;
    if (href !== "" && !href.startsWith("#"))
      findings.push(`${name(use)} draws ${href}, which the gate cannot see: draw it on the page`);
  }
  for (let depth = 0; uses.length > 0 && depth < 8; depth += 1) {
    const made = [];
    for (const use of uses) {
      if (!(use instanceof SVGUseElement)) continue;
      const href = use.href.baseVal;
      const kept = href.startsWith("#") ? byId.get(href.slice(1)) : undefined;
      if (kept === undefined) continue;
      const copy = kept.cloneNode(true);
      for (const old of copy.querySelectorAll("[data-still-copy]")) old.remove();
      // Chrome draws a used symbol as a <symbol> in the use's shadow root: a page's symbol rule reaches it and its svg rule
      // does not (measured on the engine's Chrome, round 10), so the copy stays a symbol, not counted as one kept unused
      if (kept instanceof SVGSymbolElement) drawnSymbols.add(copy);
      const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
      group.setAttribute("data-still-copy", "");
      const cs = getComputedStyle(use);
      for (const prop of [
        "fill",
        "stroke",
        "stroke-width",
        "color",
        "visibility",
        "font-family",
        "font-size",
      ])
        group.style.setProperty(prop, cs.getPropertyValue(prop));
      // a use's currentColor paint is inherited as the keyword, so a shape that sets its own color paints that colour
      for (const prop of ["fill", "stroke"])
        if (cs.getPropertyValue(prop) === cs.color) group.style.setProperty(prop, "currentColor");
      group.append(copy);
      made.push([use, group]);
    }
    for (const [use, group] of made) use.before(group);
    copies.push(...made.map(([, group]) => group));
    uses = made.flatMap(([, group]) => [...group.querySelectorAll("use")]);
  }
  if (uses.some((use) => use instanceof SVGUseElement))
    findings.push(
      "<use> nested more than 8 deep, or drawing itself, which the gate cannot read: draw it flatter",
    );
  try {
    return { ...read(), text };
  } finally {
    for (const group of copies) group.remove();
  }

  function read() {
    // a marker is drawn where a shape's marker property names it
    const markers = [...document.querySelectorAll("marker")];
    const marked = new Set();
    for (const el of document.querySelectorAll("svg *")) {
      const cs = getComputedStyle(el);
      for (const value of [cs.markerStart, cs.markerMid, cs.markerEnd]) {
        for (const marker of markers)
          if (marker.id && (value || "").includes(`#${marker.id}"`)) marked.add(marker);
      }
    }
    // Only a shape or a text paints its fill and stroke (a group, an image or a clip path keeps the default black and
    // paints none), and not inside a clip path, a mask or a pattern, nor inside defs, a symbol or a marker nothing draws.
    const paints = (el) => {
      if (!(el instanceof SVGGeometryElement || el instanceof SVGTextContentElement)) return false;
      let drawn = false;
      for (let at = el; at !== null; at = at.parentElement) {
        if (marked.has(at)) drawn = true;
        const shapes =
          at instanceof SVGClipPathElement ||
          at instanceof SVGMaskElement ||
          at instanceof SVGPatternElement;
        if (shapes) return false;
        const stored =
          at instanceof SVGDefsElement ||
          (at instanceof SVGSymbolElement && !drawnSymbols.has(at)) ||
          at instanceof SVGMarkerElement;
        if (stored && !drawn) return false;
      }
      return true;
    };
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
      // a filter or a blend paints colours outside the palette from colours in it (round 10)
      if (cs.filter && cs.filter !== "none")
        findings.push(
          `filter ${cs.filter} on ${name(el)}, which paints colours outside the palette`,
        );
      if (cs.mixBlendMode && cs.mixBlendMode !== "normal")
        findings.push(
          `mix-blend-mode ${cs.mixBlendMode} on ${name(el)}, which paints colours outside the palette`,
        );
      if (cs.backdropFilter && cs.backdropFilter !== "none")
        findings.push(`backdrop-filter on ${name(el)}`);
      const ownText = [...el.childNodes].some(
        (n) => n.nodeType === 3 && n.textContent.trim() !== "",
      );
      if (ownText) {
        families.add(
          cs.fontFamily
            .split(",")[0]
            .trim()
            .replace(/^["']|["']$/g, ""),
        );
        smallest = Math.min(smallest, parseFloat(cs.fontSize));
        // an svg text paints its fill, never its color
        if (!(el instanceof SVGElement)) colors.add(cs.color);
      }
      colors.add(cs.backgroundColor);
      for (const side of ["Top", "Right", "Bottom", "Left"]) {
        if (parseFloat(cs[`border${side}Width`]) > 0 && cs[`border${side}Style`] !== "none")
          colors.add(cs[`border${side}Color`]);
      }
      if (el instanceof SVGElement && !(el instanceof SVGSVGElement)) {
        // a line has no inside to fill, nor has a path drawn as a hairline (its box is flat); a stroke shows only with a
        // width
        const flat = (box) => box.width === 0 || box.height === 0;
        const fills = paints(el) && !(el instanceof SVGLineElement) && !flat(el.getBBox());
        if (fills && cs.fill !== "none" && !cs.fill.startsWith("url(")) colors.add(cs.fill);
        const stroked = paints(el) && parseFloat(cs.strokeWidth) > 0;
        if (stroked && cs.stroke !== "none" && !cs.stroke.startsWith("url(")) colors.add(cs.stroke);
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
    };
  }
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
