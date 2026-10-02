#!/usr/bin/env node
/**
 * Matter of Place brand assets generator.
 *
 *   node launch/tools/brand-build.mjs        (run from the repository root)
 *
 * Writes everything under brand/ from the sources of truth in app/:
 *   emblem   app/src/components/brand/emblem.tsx and app/public/favicon.svg
 *   wordmark app/src/components/brand/wordmark.tsx and .brand-* in app/src/styles/base.css
 *   palette  app/src/styles/tokens.css and CLAUDE.md
 *   fonts    github.com/google/fonts (SIL Open Font License), fetched only when a file is missing
 *
 * Text in every SVG is outlined (paths), never <text>. Deterministic: a second run rewrites nothing.
 * Needs Chrome for the PNGs (software rendering only: GPU rasterisation gave different pixels from run to run, 19 distinct hashes in 40 renders of one 256 px emblem) (set CHROME_PATH to override the default install path).
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const fontkit = require("fontkit");
const wawoff2 = require("wawoff2");
const puppeteer = require("puppeteer-core");

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const BRAND = path.join(ROOT, "brand");
const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";

/* ------------------------------------------------------------------ palette */

export const PALETTE = [
  { name: "Obsidian", slug: "obsidian", hex: "#11110F", role: "Text on light grounds, dark grounds, the emblem on light backgrounds." },
  { name: "Bone", slug: "bone", hex: "#EEEAE1", role: "Secondary surfaces, the emblem and wordmark on dark backgrounds." },
  { name: "Warm Ivory", slug: "warm-ivory", hex: "#F5F2EB", role: "Page background, the default ground for editorial pages." },
  { name: "Sandstone", slug: "sandstone", hex: "#C9C0B2", role: "Borders, hairlines and quiet accents." },
  { name: "Mineral Grey", slug: "mineral-grey", hex: "#575751", role: "Body copy and secondary text on light grounds." },
  { name: "Warm Grey", slug: "warm-grey", hex: "#8B877F", role: "Metadata and large text only, never body copy." },
];
const C = Object.fromEntries(PALETTE.map((p) => [p.slug, p.hex]));
const rgbOf = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/* ------------------------------------------------------------------ emblem (emblem.tsx, viewBox 0 0 68 76) */

const EMBLEM_D1 = "M8 5 34 16 20 21v43L8 70V5Z";
const EMBLEM_D2 = "M8 5h52v65l-12-6V21L8 5Z";
const EMBLEM_INK = { x0: 8, y0: 5, x1: 60, y1: 70 }; // ink box of the two paths
/**
 * Seam fix. In the app's emblem the two planes abut and do not quite share their diagonal: the dark plane's edge
 * runs (8,5)-(34,16), the light plane's runs (8,5)-(48,21), so a sliver of background shows between them and an
 * antialiased seam shows along the rest. In these assets the light plane is drawn with a path that reaches under the
 * dark plane (EMBLEM_LIGHT_UNDER: its lower diagonal ends at the dark plane's tip (34,16), then runs inside the dark
 * plane), and the dark plane is drawn on top, so no two edges meet. The dark plane is unchanged. The light plane moves
 * by at most 0.6 units (under 1 percent of the emblem's height) at the tip.
 */
const EMBLEM_LIGHT_UNDER = "M8 5h52v65l-12-6V21L34 16 30 16.4 9 6.2 8 5Z";
const mixHex = (bg, fg, a) =>
  "#" + [1, 3, 5].map((k) => Math.round(parseInt(bg.slice(k, k + 2), 16) * (1 - a) + parseInt(fg.slice(k, k + 2), 16) * a).toString(16).padStart(2, "0")).join("").toUpperCase();
/**
 * Single colour, transparent background, true opacities .9 and .4 and no overlap stripe: a luminance mask carries the
 * two strengths (light plane 40 percent, dark plane drawn over it at 90 percent, so the mask itself never double
 * composites), and one rectangle in the brand colour is revealed through it.
 */
const emblemPaths = (fill, id = "emblem-planes") =>
  `<defs><mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="68" height="76" color-interpolation="sRGB"><path d="${EMBLEM_LIGHT_UNDER}" fill="#666666"/><path d="${EMBLEM_D1}" fill="#E6E6E6"/></mask></defs><rect width="68" height="76" fill="${fill}" mask="url(#${id})"/>`;
/** The tile uses the favicon's own transform (app/public/favicon.svg). Tones are pre-blended against the tile, so the planes are solid. */
const tilePaths = (bg, fg) =>
  `<rect width="64" height="64" fill="${bg}"/><g transform="translate(8.88 6.6) scale(0.68)"><path d="${EMBLEM_LIGHT_UNDER}" fill="${mixHex(bg, fg, 0.4)}"/><path d="${EMBLEM_D1}" fill="${mixHex(bg, fg, 0.9)}"/></g>`;

/* ------------------------------------------------------------------ fonts */

const FONT_SOURCES = {
  jost: { dir: "jost", file: "Jost%5Bwght%5D.ttf", repo: "jost", out: "jost-variable", family: "Jost" },
  urbanist: { dir: "urbanist", file: "Urbanist%5Bwght%5D.ttf", repo: "urbanist", out: "urbanist-variable", family: "Urbanist" },
  cormorant: { dir: "cormorant-garamond", file: "CormorantGaramond%5Bwght%5D.ttf", repo: "cormorantgaramond", out: "cormorant-garamond-variable", family: "Cormorant Garamond" },
  epilogue: { dir: "epilogue", file: "Epilogue%5Bwght%5D.ttf", repo: "epilogue", out: "epilogue-variable", family: "Epilogue" },
};
const RAW = "https://raw.githubusercontent.com/google/fonts/main/ofl";

async function ensureFonts() {
  for (const f of Object.values(FONT_SOURCES)) {
    const dir = path.join(BRAND, "typography", f.dir);
    fs.mkdirSync(dir, { recursive: true });
    for (const [rel, remote] of [[`${f.out}.ttf`, f.file], ["OFL.txt", "OFL.txt"]]) {
      const target = path.join(dir, rel);
      if (fs.existsSync(target)) continue;
      const res = await fetch(`${RAW}/${f.repo}/${remote}`);
      if (!res.ok) throw new Error(`download failed ${res.status} for ${f.repo}/${remote}`);
      fs.writeFileSync(target, Buffer.from(await res.arrayBuffer()));
      console.log("downloaded", path.relative(ROOT, target));
    }
  }
}

const fontCache = new Map();
function fontAt(key, wght) {
  const id = `${key}:${wght}`;
  if (!fontCache.has(id)) {
    const f = FONT_SOURCES[key];
    const base = fontkit.openSync(path.join(BRAND, "typography", f.dir, `${f.out}.ttf`));
    fontCache.set(id, base.getVariation({ wght }));
  }
  return fontCache.get(id);
}

/* ------------------------------------------------------------------ outline helpers */

const rnd = (v) => {
  const r = Math.round(v * 100) / 100;
  return r === 0 ? 0 : r;
};

/** Scale a glyph's commands from font units to output units; y is flipped, origin at (ox, oy). */
function place(cmds, s, ox, oy) {
  return cmds.map((c) => ({ command: c.command, args: c.args.map((v, i) => (i % 2 === 0 ? ox + v * s : oy - v * s)) }));
}

function splitContours(cmds) {
  const out = [];
  for (const c of cmds) {
    if (c.command === "moveTo") out.push([]);
    out[out.length - 1].push(c);
  }
  return out;
}

function bboxOfCmds(cmds, box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }) {
  const grow = (x, y) => {
    box.x0 = Math.min(box.x0, x); box.y0 = Math.min(box.y0, y);
    box.x1 = Math.max(box.x1, x); box.y1 = Math.max(box.y1, y);
  };
  let cx = 0, cy = 0;
  for (const { command, args } of cmds) {
    if (command === "moveTo" || command === "lineTo") { [cx, cy] = args; grow(cx, cy); }
    else if (command === "quadraticCurveTo") {
      const [x1, y1, x, y] = args;
      for (let t = 0; t <= 1.0001; t += 1 / 64) {
        grow((1 - t) ** 2 * cx + 2 * (1 - t) * t * x1 + t * t * x, (1 - t) ** 2 * cy + 2 * (1 - t) * t * y1 + t * t * y);
      }
      cx = x; cy = y;
    } else if (command === "bezierCurveTo") {
      const [x1, y1, x2, y2, x, y] = args;
      for (let t = 0; t <= 1.0001; t += 1 / 64) {
        const u = 1 - t;
        grow(u ** 3 * cx + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t ** 3 * x, u ** 3 * cy + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t ** 3 * y);
      }
      cx = x; cy = y;
    }
  }
  return box;
}

const unionBox = (a, b) => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) });

function pathData(cmds, dx = 0, dy = 0) {
  const f = (v, i) => rnd(v + (i % 2 === 0 ? dx : dy));
  const letter = { moveTo: "M", lineTo: "L", quadraticCurveTo: "Q", bezierCurveTo: "C", closePath: "Z" };
  return cmds.map((c) => letter[c.command] + c.args.map(f).join(" ")).join("");
}

/**
 * The brand lambda: Jost has no U+039B, so the site falls back to another font for that letter.
 * The intended letter is the Jost "A" without its crossbar, at the same weight, height and width.
 * In Jost Light the crossbar is its own contour, so the lambda is the A with that contour removed.
 */
function lambdaContours(glyph) {
  const contours = splitContours(glyph.path.commands);
  if (contours.length !== 2) throw new Error(`Jost A expected 2 contours, found ${contours.length}`);
  const heights = contours.map((c) => { const b = bboxOfCmds(c); return b.y1 - b.y0; });
  const bar = heights[0] < heights[1] ? 0 : 1;
  if (heights[bar] > 150 || heights[1 - bar] < 700) throw new Error(`Jost A contours are not bar plus legs: ${heights}`);
  return contours[1 - bar].flat();
}

/** Lay out text in one font at one size. Lambda is shaped as "A" (so it takes the A kerning) and drawn without the bar. */
function layoutRun(font, text, size, letterSpacing) {
  const chars = [...text];
  const run = font.layout(chars.map((ch) => (ch === "Λ" ? "A" : ch)).join(""));
  if (run.glyphs.length !== chars.length) throw new Error(`ligature or cluster in "${text}"`);
  const s = size / font.unitsPerEm;
  return chars.map((ch, i) => {
    const g = run.glyphs[i];
    if (g.id === 0) throw new Error(`no glyph for "${ch}" in ${font.familyName}`);
    const cmds = ch === "Λ" ? lambdaContours(g) : g.path.commands;
    return { ch, cmds, s, adv: run.positions[i].xAdvance * s, ls: letterSpacing, size };
  });
}

/* ------------------------------------------------------------------ wordmark (wordmark.tsx + .brand-* in base.css) */

const WM = { weight: 300, ls: 0.24, smallH: 0.58, smallMargin: 0.18, stackedSmall: 11 / 29, stackedGap: 7 / 29, lineHeight: 1.05 };

/**
 * Returns { placed: [{cmds,...}], box } in output units, origin at the first baseline's left edge.
 * `S` is the main font size; the site renders 15 (horizontal) and 29 (stacked), the assets are drawn 10x.
 */
export function wordmarkGeometry(stacked, S = stacked ? 290 : 150) {
  const font = fontAt("jost", WM.weight);
  const ls = WM.ls * S; // letter-spacing is inherited as a length, so "OF" keeps the main size's spacing
  const asc = font.ascent / font.unitsPerEm;
  const desc = -font.descent / font.unitsPerEm;
  const out = [];
  const pens = [];
  const emit = (glyphs, x0, baseline) => {
    let pen = x0;
    for (const g of glyphs) {
      pens.push({ ch: g.ch, x: pen, baseline });
      if (g.cmds.length) out.push(place(g.cmds, g.s, pen, baseline));
      pen += g.adv + g.ls;
    }
    return pen;
  };
  if (!stacked) {
    const small = WM.smallH * S;
    let pen = 0;
    pen = emit(layoutRun(font, "MΛTTER ", S, ls), pen, 0);
    pen += WM.smallMargin * small;
    pen = emit(layoutRun(font, "OF", small, ls), pen, 0);
    pen += WM.smallMargin * small;
    emit(layoutRun(font, " PLΛCE", S, ls), pen, 0);
  } else {
    const small = WM.stackedSmall * S;
    const gap = WM.stackedGap * S;
    const rows = [
      { text: "MΛTTER", size: S },
      { text: "OF", size: small },
      { text: "PLΛCE", size: S },
    ];
    let top = 0;
    for (const row of rows) {
      const glyphs = layoutRun(font, row.text, row.size, ls);
      const width = glyphs.reduce((w, g) => w + g.adv + g.ls, 0) - ls; // centre on the ink, not on the trailing spacing
      const lh = WM.lineHeight * row.size;
      const baseline = top + (lh - (asc + desc) * row.size) / 2 + asc * row.size;
      emit(glyphs, -width / 2, baseline);
      top += lh + gap;
    }
  }
  let box;
  for (const cmds of out) box = bboxOfCmds(cmds, box);
  return { placed: out, box, pens };
}

const wordmarkPath = (geo, dx, dy) => geo.placed.map((c) => pathData(c, dx, dy)).join("");

/* ------------------------------------------------------------------ SVG assembly */

const svgDoc = (title, w, h, vb, body, px) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${px ? px[0] : rnd(w)}" height="${px ? px[1] : rnd(h)}" viewBox="${vb}">` +
  (title ? `<title>${title}</title>` : "") + body + "</svg>\n";

function emblemSvg(fill, px) {
  return svgDoc("Matter of Place emblem", 76, 76, "-4 0 76 76", emblemPaths(fill), px);
}
function tileSvg(bg, fg, px) {
  return svgDoc("Matter of Place emblem tile", 64, 64, "0 0 64 64", tilePaths(bg, fg), px);
}
function wordmarkSvg(stacked, fill, px) {
  const geo = wordmarkGeometry(stacked);
  const w = geo.box.x1 - geo.box.x0, h = geo.box.y1 - geo.box.y0;
  const body = `<path d="${wordmarkPath(geo, -geo.box.x0, -geo.box.y0)}" fill="${fill}"/>`;
  return { svg: svgDoc(`Matter of Place wordmark, ${stacked ? "stacked" : "horizontal"}`, w, h, `0 0 ${rnd(w)} ${rnd(h)}`, body, px && [px, Math.round((px * h) / w)]), w, h };
}

/**
 * Lockups. The emblem box is 2.8x the wordmark's main font size tall (the site header sets the emblem at 28px
 * beside a 10px label). Horizontal: the site has no emblem beside the wordmark, so the clear space between emblem and
 * wordmark equals the emblem's ink width. Stacked: the site footer puts the emblem above the name with 24px under a 56px
 * wide emblem, so the gap is 24/56 of the emblem's ink width.
 */
function lockupSvg(stacked, fill, px) {
  const S = stacked ? 290 : 150;
  const geo = wordmarkGeometry(stacked, S);
  const e = (2.8 * S) / 76;
  const ink = { w: (EMBLEM_INK.x1 - EMBLEM_INK.x0) * e, h: (EMBLEM_INK.y1 - EMBLEM_INK.y0) * e };
  const wm = geo.box;
  let ex, ey, dx = 0, dy = 0;
  if (!stacked) {
    ex = 0; // emblem ink left edge
    dx = ink.w + ink.w - wm.x0; // wordmark starts one emblem width after the emblem
    ey = (wm.y0 + wm.y1) / 2 - ink.h / 2; // emblem ink centred on the wordmark's caps
  } else {
    const gap = (24 / 56) * ink.w;
    const wmCx = (wm.x0 + wm.x1) / 2;
    ex = wmCx - ink.w / 2;
    ey = wm.y0 - gap - ink.h;
  }
  // emblem placement: ink left/top at (ex, ey)
  const tx = ex - EMBLEM_INK.x0 * e, ty = ey - EMBLEM_INK.y0 * e;
  const boxE = { x0: ex, y0: ey, x1: ex + ink.w, y1: ey + ink.h };
  const boxW = { x0: wm.x0 + dx, y0: wm.y0 + dy, x1: wm.x1 + dx, y1: wm.y1 + dy };
  const all = unionBox(boxE, boxW);
  const w = all.x1 - all.x0, h = all.y1 - all.y0;
  const gTransform = `translate(${rnd(tx - all.x0)} ${rnd(ty - all.y0)}) scale(${rnd(e * 1000) / 1000})`;
  const body =
    `<g transform="${gTransform}">${emblemPaths(fill, "emblem-planes")}</g>` +
    `<path d="${wordmarkPath(geo, dx - all.x0, dy - all.y0)}" fill="${fill}"/>`;
  return { svg: svgDoc(`Matter of Place lockup, ${stacked ? "stacked" : "horizontal"}`, w, h, `0 0 ${rnd(w)} ${rnd(h)}`, body, px && [px, Math.round((px * h) / w)]), w, h };
}

/* ------------------------------------------------------------------ text outlines for sheets */

/** Outline a line of text. Returns { d, width }; (x, y) is the left end of the baseline. */
function textPath(key, wght, text, size, x, y, ls = 0) {
  const font = fontAt(key, wght);
  for (const ch of text) if (!font.hasGlyphForCodePoint(ch.codePointAt(0)) && ch !== " ") throw new Error(`${font.familyName} has no "${ch}"`);
  const run = font.layout(text);
  const s = size / font.unitsPerEm;
  let pen = x, d = "";
  run.glyphs.forEach((g, i) => {
    if (g.path.commands.length) d += pathData(place(g.path.commands, s, pen, y));
    pen += run.positions[i].xAdvance * s + ls;
  });
  return { d, width: pen - x - ls };
}
const tp = (fill, key, wght, text, size, x, y, ls = 0) => {
  const r = textPath(key, wght, text, size, x, y, ls);
  return { svg: `<path d="${r.d}" fill="${fill}"/>`, width: r.width };
};

/* ------------------------------------------------------------------ palette sheet */

function paletteSheet() {
  const W = 1800, M = 100, gap = 20, n = PALETTE.length;
  const sw = (W - 2 * M - gap * (n - 1)) / n; // 250
  const H = 880;
  let body = `<rect width="${W}" height="${H}" fill="${C["warm-ivory"]}"/>`;
  body += tp(C.obsidian, "cormorant", 400, "Palette", 64, M, 140).svg;
  body += tp(C["mineral-grey"], "urbanist", 500, "MATTER OF PLACE", 14, M, 180, 3).svg;
  PALETTE.forEach((p, i) => {
    const x = M + i * (sw + gap);
    body += `<rect x="${x}" y="230" width="${sw}" height="380" fill="${p.hex}"/>`;
    body += `<rect x="${x + 0.5}" y="230.5" width="${sw - 1}" height="379" fill="none" stroke="${C.sandstone}" stroke-width="1"/>`;
    body += tp(C.obsidian, "jost", 400, p.name, 26, x, 660).svg;
    body += tp(C.obsidian, "urbanist", 500, p.hex, 16, x, 700, 1.2).svg;
    body += tp(C["mineral-grey"], "urbanist", 300, `RGB ${rgbOf(p.hex).join(" ")}`, 15, x, 726, 1).svg;
    const short = {
      obsidian: ["Text and dark grounds"], bone: ["Secondary surface"], "warm-ivory": ["Page background"],
      sandstone: ["Borders and accents"], "mineral-grey": ["Body and secondary text"], "warm-grey": ["Metadata, large text only"],
    }[p.slug];
    short.forEach((line, k) => { body += tp(C["mineral-grey"], "urbanist", 300, line, 15, x, 760 + k * 22).svg; });
  });
  return svgDoc("Matter of Place palette", W, H, `0 0 ${W} ${H}`, body);
}

/* ------------------------------------------------------------------ type specimen sheet */

const SPECIMEN = [
  { key: "jost", nameWeight: 300, role: "UTILITY AND WORDMARK", weights: [300, 400, 500, 600], sentence: "Exceptional property. Properly considered.", sentenceWeight: 300, size: 52 },
  { key: "urbanist", nameWeight: 500, role: "INTERFACE, NAVIGATION AND LABELS", weights: [300, 500, 700], sentence: "Open by appointment, Monday to Saturday.", sentenceWeight: 500, size: 46 },
  { key: "cormorant", nameWeight: 400, role: "EDITORIAL TITLES AND COPY", weights: [400, 500], sentence: "Place matters. A house is only as good as where it stands.", sentenceWeight: 400, size: 60 },
  { key: "epilogue", nameWeight: 300, role: "FOOTER AND OVERLAYS", weights: [300, 400], sentence: "Selective property in California, New York and Florida.", sentenceWeight: 300, size: 40 },
];

function specimenSheet() {
  const W = 1800, M = 100, rowH = 54, colX = 700;
  const upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ", lower = "abcdefghijklmnopqrstuvwxyz";
  let body = "", y = 0;
  body += tp(C.obsidian, "cormorant", 400, "Typography", 64, M, 140).svg;
  body += tp(C["mineral-grey"], "urbanist", 500, "MATTER OF PLACE", 14, M, 180, 3).svg;
  y = 250;
  for (const fam of SPECIMEN) {
    const f = FONT_SOURCES[fam.key];
    const rows = fam.weights.length;
    const secH = 130 + rows * rowH + 130;
    body += `<rect x="${M}" y="${y}" width="${W - 2 * M}" height="1" fill="${C.sandstone}"/>`;
    // left column
    body += tp(C.obsidian, fam.key, fam.nameWeight, f.family, 64, M, y + 100).svg;
    body += tp(C["mineral-grey"], "urbanist", 500, fam.role, 13, M, y + 140, 2.4).svg;
    body += tp(C["mineral-grey"], "urbanist", 300, `WEIGHTS USED  ${fam.weights.join("  ")}`, 13, M, y + 166, 2.4).svg;
    // right column: one alphabet row per weight
    fam.weights.forEach((wt, i) => {
      const base = y + 100 + i * rowH;
      body += tp(C["warm-grey"], "urbanist", 500, String(wt), 13, colX, base - 4, 1.5).svg;
      const a = tp(C.obsidian, fam.key, wt, `${upper} ${lower}`, 27, colX + 60, base, 0.6);
      if (colX + 60 + a.width > W - M) throw new Error(`specimen row too wide for ${f.family} ${wt}: ${a.width}`);
      body += a.svg;
    });
    const digits = tp(C["mineral-grey"], fam.key, fam.weights[0], "0123456789 & $ . , : ; ( ) · %", 27, colX + 60, y + 100 + rows * rowH, 0.6);
    body += digits.svg;
    const sent = tp(C.obsidian, fam.key, fam.sentenceWeight, fam.sentence, fam.size, M, y + 100 + rows * rowH + 110);
    if (M + sent.width > W - M) throw new Error(`sample sentence too wide for ${f.family}: ${sent.width}`);
    body += sent.svg;
    y += secH + 40;
  }
  const H = y + 60;
  body = `<rect width="${W}" height="${H}" fill="${C["warm-ivory"]}"/>` + body;
  return svgDoc("Matter of Place typography specimen", W, H, `0 0 ${W} ${H}`, body);
}

/* ------------------------------------------------------------------ Adobe Swatch Exchange */

function aseBuffer() {
  const blocks = PALETTE.map((p) => {
    const name = Buffer.alloc((p.name.length + 1) * 2);
    for (let i = 0; i < p.name.length; i++) name.writeUInt16BE(p.name.charCodeAt(i), i * 2);
    const body = Buffer.alloc(2 + name.length + 4 + 12 + 2);
    let o = 0;
    body.writeUInt16BE(p.name.length + 1, o); o += 2;
    name.copy(body, o); o += name.length;
    body.write("RGB ", o, "ascii"); o += 4;
    for (const v of rgbOf(p.hex)) { body.writeFloatBE(v / 255, o); o += 4; }
    body.writeUInt16BE(2, o); // normal colour
    const head = Buffer.alloc(6);
    head.writeUInt16BE(1, 0); head.writeUInt32BE(body.length, 2);
    return Buffer.concat([head, body]);
  });
  const head = Buffer.alloc(12);
  head.write("ASEF", 0, "ascii"); head.writeUInt16BE(1, 4); head.writeUInt16BE(0, 6); head.writeUInt32BE(blocks.length, 8);
  return Buffer.concat([head, ...blocks]);
}

function parseAse(buf) {
  if (buf.toString("ascii", 0, 4) !== "ASEF") throw new Error("ase: bad signature");
  const n = buf.readUInt32BE(8);
  let o = 12;
  const out = [];
  for (let i = 0; i < n; i++) {
    if (buf.readUInt16BE(o) !== 1) throw new Error("ase: unexpected block type");
    const len = buf.readUInt32BE(o + 2);
    let p = o + 6;
    const nl = buf.readUInt16BE(p); p += 2;
    let name = "";
    for (let k = 0; k < nl - 1; k++) name += String.fromCharCode(buf.readUInt16BE(p + k * 2));
    p += nl * 2;
    if (buf.toString("ascii", p, p + 4) !== "RGB ") throw new Error("ase: not RGB");
    p += 4;
    const rgb = [0, 1, 2].map((k) => Math.round(buf.readFloatBE(p + k * 4) * 255));
    out.push({ name, hex: "#" + rgb.map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase() });
    o += 6 + len;
  }
  if (o !== buf.length) throw new Error("ase: trailing bytes");
  return out;
}

/* ------------------------------------------------------------------ writer */

const written = new Set();
let changed = 0;
function put(rel, data) {
  const file = path.join(BRAND, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const buf = Buffer.isBuffer(data) || data instanceof Uint8Array ? Buffer.from(data) : Buffer.from(data.replace(/\r\n/g, "\n"), "utf8");
  written.add(rel.replaceAll("\\", "/"));
  if (fs.existsSync(file) && Buffer.compare(fs.readFileSync(file), buf) === 0) return;
  fs.writeFileSync(file, buf);
  changed++;
}

/* ------------------------------------------------------------------ PNG rendering (Chrome) */

let browser, page;
async function png(svgFn, w, h) {
  // svgFn(px) returns the svg sized for the target pixels
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html><head><style>html,body{margin:0;padding:0;background:transparent}svg{display:block}</style></head><body>${svgFn}</body></html>`);
  return Buffer.from(await page.screenshot({ type: "png", omitBackground: true, clip: { x: 0, y: 0, width: w, height: h } }));
}

/* ------------------------------------------------------------------ README */

function readme() {
  const sizesE = "64, 128, 256, 512, 1024 and 2048";
  return `# Matter of Place brand assets

This folder holds every brand asset of Matter of Place in ready-to-use formats. Nothing here is a redesign. It is an export of the identity as the website uses it. If a file is missing or out of date, run the one command at the end of this page and everything is rebuilt.

Every SVG here is built from outlines. Text in the SVG files is drawn as shapes, so the logos look the same on a computer that does not have the typefaces installed. The PNG files have transparent backgrounds unless the name says "on" a colour.

## What the identity is made of

Matter of Place is a selective real-estate publication. The idea is that a property is more than an asset, and that place matters. The line is "Exceptional property. Properly considered."

The identity has four parts.

1. The emblem. Two tall vertical planes that meet at a doorway. The left plane is a darker, solid shape. The right plane is lighter and wider, and it has an opening cut into it like a threshold. It is never a house, a roof, a key or a pin.
2. The wordmark. The words MATTER OF PLACE in capital letters, set in Jost Light with wide letter spacing. The word OF is smaller than the other two. The letter A in MATTER and in PLACE is drawn as an inverted V, with no crossbar. This is a Greek capital lambda.
3. The colours. Six quiet, warm tones. Photography supplies all other colour.
4. The typefaces. Jost and Urbanist for utility, Cormorant Garamond for editorial voice, Epilogue for the footer and overlays.

A note on the lambda. The font Jost has no lambda letter, so the website quietly borrows one from the visitor's system font, which is a heavier Arial letter on most machines. These assets do not copy that accident. The lambda here is the Jost Light letter A with its crossbar removed, at the same weight, height and width as the other letters.

## Folder logo/emblem

The emblem alone, in four versions. All files in this folder show the same two planes, the left one at 90 percent strength and the right one at 40 percent strength.

- emblem-obsidian.svg: the emblem in near-black Obsidian on a transparent background. Use it on light backgrounds such as Warm Ivory, Bone or white paper.
- emblem-bone.svg: the emblem in pale Bone on a transparent background. Use it on dark backgrounds or over dark photographs.
- emblem-on-obsidian.svg: a square tile with a solid Obsidian background and the Bone emblem centred inside, with generous space around it. The same picture as the website's favicon.
- emblem-on-bone.svg: a square tile with a solid Bone background and the Obsidian emblem centred inside.
- PNG versions of all four, in square sizes of ${sizesE} pixels. The size is the side of the square. For example emblem-obsidian-512.png is 512 by 512 pixels with a transparent background, and emblem-on-bone-1024.png is 1024 by 1024 pixels with a Bone background.

The emblem here is drawn so the two planes meet with no gap at any size: the lighter plane runs a little under the darker one. The single colour SVGs use a mask to keep the two strengths exact. The website's own emblem (the favicon and the header) still has the two paths abutting, which can show a hairline at large sizes. That is a known follow-up for the site and is not changed here.

Clear space: keep at least half of the emblem's width free on every side. Minimum size: 16 pixels high on screen, 6 millimetres in print. Below 32 pixels prefer the tile versions.

## Folder logo/wordmark

The words alone, cropped tight to the letters, with no extra margin. Add the clear space yourself when you place it.

- wordmark-horizontal-obsidian.svg and wordmark-horizontal-bone.svg: MATTER OF PLACE on one line, in Obsidian for light backgrounds and in Bone for dark backgrounds. The line is about fifteen times as wide as it is tall.
- wordmark-stacked-obsidian.svg and wordmark-stacked-bone.svg: three centred lines, MATTER, then a small OF, then PLACE. Use it where the space is narrow or tall, such as a social profile or a spine.
- PNG versions of all four with a transparent background, at widths of 600, 1200, 2400 and 4800 pixels. The height follows the shape. For example wordmark-horizontal-bone-2400.png is 2400 pixels wide.

Clear space: keep free, on every side, the height of the capital letter M. Minimum size: the horizontal wordmark should be at least 120 pixels wide on screen or 25 millimetres in print. The stacked one at least 80 pixels wide or 18 millimetres.

## Folder logo/lockup

The emblem and the wordmark together, ready placed.

- lockup-horizontal-obsidian.svg and lockup-horizontal-bone.svg: the emblem on the left, the wordmark on the right, centred on the same line. The space between the two is exactly the width of the emblem.
- lockup-stacked-obsidian.svg and lockup-stacked-bone.svg: the emblem above, the three-line wordmark below, centred. The space between them is a little under half of the emblem's width, which is how the website footer places its emblem above the name.
- PNG versions of all four, with transparent backgrounds, at widths of 1200, 2400 and 4800 pixels. For example lockup-stacked-obsidian-2400.png.

The website itself does not show the emblem next to this wordmark. Its header and footer set the emblem above a small Urbanist name. The lockups are therefore built from the site's ratios: the emblem is 2.8 times as tall as the wordmark's main letters, as in the header, and the stacked gap follows the footer.

Clear space: keep free, on every side, the width of the emblem. Minimum width: 160 pixels on screen or 30 millimetres in print.

## Folder icons

Small square pictures for browsers, phones and social profiles.

- favicon.svg: the browser tab icon, a copy of the file the website serves. Bone emblem on an Obsidian square.
- favicon.ico: the same picture in the old icon format, for older browsers. A copy of the file the website serves.
- apple-touch-icon.png: the picture iPhones use when the site is saved to the home screen. A copy of the file the website serves.
- avatar-obsidian-180.png, 192, 400, 512 and 1024: square profile pictures with a solid Obsidian background and the Bone emblem. The number is the side in pixels. Use them for Instagram, X, LinkedIn and app icons.
- avatar-bone-180.png, 192, 400, 512 and 1024: the same with a Bone background and the Obsidian emblem. Use them where a lighter picture suits the page.

The emblem sits well inside the square, so a circular crop, as most social sites apply, does not touch it. Do not add text to an avatar.

## Folder colors

The palette, in four formats and one picture.

- palette.png and palette.svg: one sheet with six tall swatches in a row. Under each swatch are its name, its hex value, its RGB value and its role.
- palette.json: the six colours as data, each with name, hex, rgb and role.
- palette.css: the six colours as CSS custom properties, such as --obsidian and --warm-ivory.
- palette.ase: an Adobe Swatch Exchange file, which Photoshop, Illustrator and InDesign can load as a swatch library. It was written with plain code and read back by a checker in this repository. It has not been opened in an Adobe program yet.

The six colours:

${PALETTE.map((p) => `- ${p.name}, ${p.hex}, RGB ${rgbOf(p.hex).join(" ")}. ${p.role}`).join("\n")}

Photography supplies every other colour. Do not add an accent colour.

## Folder typography

The four typefaces of the website, as the font files themselves, with their licence.

- jost/: Jost, a geometric sans. Role: navigation, facts, prices, labels and the wordmark. Weights used: 300 Light, 400 Regular, 500 Medium, 600 SemiBold.
- urbanist/: Urbanist, a geometric sans. Role: interface and utility text, small caps labels. Weights used: 300 Light, 500 Medium, 700 Bold.
- cormorant-garamond/: Cormorant Garamond, a serif. Role: titles, editorial copy, pull quotes. Weights used: 400 Regular, 500 Medium.
- epilogue/: Epilogue, a grotesque sans. Role: the footer and overlays. Weights used: 300 Light, 400 Regular.

Each family folder holds a variable TrueType file (name ending in variable.ttf), a variable WOFF2 file for websites (name ending in variable.woff2), and OFL.txt, the SIL Open Font License that allows free use, including commercial use. The repository of Google Fonts ships these four families only as variable fonts, so there are no separate static files per weight. One variable file contains every weight, including the ones listed above. A modern design program lets you pick the weight by name or number.

The WOFF2 files are the same fonts compressed for the web. They are not cut down to the used weights.

- fonts.css: ready-made @font-face rules that point to the four WOFF2 files, so a web page can use the families by name.
- specimen.png and specimen.svg: one long sheet. For each family it shows the name set in the family, its role, the weights used, the alphabet in each weight, and one calm sentence. All text is outlined in the SVG.

## Use and do not use

Use the logos only in Obsidian or Bone. Put Obsidian on light grounds and Bone on dark ones. Keep photography calm behind the logo, or place the logo on a plain area.

Do not use any of these.

- No gradients, no glow, no drop shadow, no outline, no bevel.
- No gold, and no black and gold pairing. No real-estate blue.
- No stretching, squeezing, slanting or rotating the logos. Keep the width and height in proportion.
- No recolouring outside the six palette colours. Do not use a logo colour that is not Obsidian or Bone.
- No rebuilding the wordmark by typing it. Use the files. In particular do not type the letter A where the lambda belongs.
- No house, roof, key or pin drawn next to the emblem.
- No rounded corners on the tiles, except where a platform forces a round crop.

## Rebuild everything

From the repository root, with Chrome installed, run this one command.

    node launch/tools/brand-build.mjs

It rewrites the whole folder from the website's own source files. Running it twice changes nothing. The tool lives in launch/tools, and its code libraries are listed in launch/package.json. To also compare the outlined wordmark with how Chrome draws the website's text, run launch/tools/brand-wordmark-check.mjs.
`;
}

function fontsCss() {
  return Object.values(FONT_SOURCES)
    .map((f) => `@font-face {\n  font-family: "${f.family}";\n  src: url("./${f.dir}/${f.out}.woff2") format("woff2");\n  font-weight: 100 900;\n  font-style: normal;\n  font-display: swap;\n}\n`)
    .join("\n");
}

/* ------------------------------------------------------------------ main */

async function main() {
  await ensureFonts();
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--force-color-profile=srgb", "--disable-gpu", "--disable-gpu-rasterization", "--disable-accelerated-2d-canvas", "--use-gl=disabled"] });
  page = await browser.newPage();
  try {
    // emblem
    for (const [name, fill] of [["obsidian", C.obsidian], ["bone", C.bone]]) {
      put(`logo/emblem/emblem-${name}.svg`, emblemSvg(fill));
      for (const n of [64, 128, 256, 512, 1024, 2048]) put(`logo/emblem/emblem-${name}-${n}.png`, await png(emblemSvg(fill, [n, n]), n, n));
    }
    for (const [name, bg, fg] of [["obsidian", C.obsidian, C.bone], ["bone", C.bone, C.obsidian]]) {
      put(`logo/emblem/emblem-on-${name}.svg`, tileSvg(bg, fg));
      for (const n of [64, 128, 256, 512, 1024, 2048]) put(`logo/emblem/emblem-on-${name}-${n}.png`, await png(tileSvg(bg, fg, [n, n]), n, n));
    }
    // wordmark and lockup
    for (const stacked of [false, true]) {
      const layout = stacked ? "stacked" : "horizontal";
      for (const [name, fill] of [["obsidian", C.obsidian], ["bone", C.bone]]) {
        const wm = wordmarkSvg(stacked, fill);
        put(`logo/wordmark/wordmark-${layout}-${name}.svg`, wm.svg);
        for (const n of [600, 1200, 2400, 4800]) {
          const h = Math.round((n * wm.h) / wm.w);
          put(`logo/wordmark/wordmark-${layout}-${name}-${n}.png`, await png(wordmarkSvg(stacked, fill, n).svg, n, h));
        }
        const lk = lockupSvg(stacked, fill);
        put(`logo/lockup/lockup-${layout}-${name}.svg`, lk.svg);
        for (const n of [1200, 2400, 4800]) {
          const h = Math.round((n * lk.h) / lk.w);
          put(`logo/lockup/lockup-${layout}-${name}-${n}.png`, await png(lockupSvg(stacked, fill, n).svg, n, h));
        }
      }
    }
    // icons
    for (const f of ["favicon.svg", "favicon.ico", "apple-touch-icon.png"]) {
      const src = path.join(ROOT, "app", "public", f);
      if (!fs.existsSync(src)) throw new Error(`missing ${src}`);
      put(`icons/${f}`, fs.readFileSync(src));
    }
    for (const [name, bg, fg] of [["obsidian", C.obsidian, C.bone], ["bone", C.bone, C.obsidian]]) {
      for (const n of [180, 192, 400, 512, 1024]) put(`icons/avatar-${name}-${n}.png`, await png(tileSvg(bg, fg, [n, n]), n, n));
    }
    // colours
    const sheet = paletteSheet();
    put("colors/palette.svg", sheet);
    put("colors/palette.png", await png(sheet, 1800, 880));
    put("colors/palette.json", JSON.stringify(PALETTE.map((p) => ({ name: p.name, hex: p.hex, rgb: rgbOf(p.hex), role: p.role })), null, 2) + "\n");
    put("colors/palette.css", ":root {\n" + PALETTE.map((p) => `  --${p.slug}: ${p.hex};`).join("\n") + "\n}\n");
    const ase = aseBuffer();
    const back = parseAse(ase);
    PALETTE.forEach((p, i) => { if (back[i].name !== p.name || back[i].hex !== p.hex) throw new Error("ase round trip failed"); });
    put("colors/palette.ase", ase);
    // typography
    for (const f of Object.values(FONT_SOURCES)) {
      const ttf = fs.readFileSync(path.join(BRAND, "typography", f.dir, `${f.out}.ttf`));
      put(`typography/${f.dir}/${f.out}.ttf`, ttf);
      put(`typography/${f.dir}/OFL.txt`, fs.readFileSync(path.join(BRAND, "typography", f.dir, "OFL.txt")));
      put(`typography/${f.dir}/${f.out}.woff2`, Buffer.from(await wawoff2.compress(ttf)));
    }
    put("typography/fonts.css", fontsCss());
    const spec = specimenSheet();
    const m = spec.match(/width="(\d+)" height="(\d+)"/);
    put("typography/specimen.svg", spec);
    put("typography/specimen.png", await png(spec, Number(m[1]), Number(m[2])));
    put("README.md", readme());
  } finally {
    await browser.close();
  }

  // hygiene: nothing in brand/ that the generator does not own
  const present = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else present.push(path.relative(BRAND, p).replaceAll("\\", "/"));
    }
  })(BRAND);
  const stray = present.filter((f) => !written.has(f));
  if (stray.length) throw new Error(`files in brand/ the generator does not own: ${stray.join(", ")}`);
  for (const f of written) {
    if (f.endsWith(".svg") && f.startsWith("logo/") && fs.readFileSync(path.join(BRAND, f), "utf8").includes("<text")) throw new Error(`<text in ${f}`);
    if (/\.(svg|md|css|json)$/.test(f) && /[\u2014\u2013]/.test(fs.readFileSync(path.join(BRAND, f), "utf8"))) throw new Error(`dash character in ${f}`);
  }
  console.log(`brand-build: ${written.size} files, ${changed} written or changed`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
export { wordmarkPath, fontAt, FONT_SOURCES, WM, BRAND, CHROME };
