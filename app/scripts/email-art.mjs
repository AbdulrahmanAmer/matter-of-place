// `node scripts/email-art.mjs`: draws the artwork of the emails as SVG and writes it as PNG to public/email/
// (operator, 2026-10-12: "go all out on the emails, custom SVGs"). Mail clients strip inline SVG (Gmail, Outlook),
// so the SVG is rendered here, at twice its display size, and the emails show the PNG from matterofplace.com.
// The marks come from the outlined lockups of ../brand (no font needed to render them). Run it after a brand change
// and commit the PNGs; nothing renders at send time.
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const brand = join(here, "../../brand/logo");
const out = join(here, "../public/email");
mkdirSync(out, { recursive: true });

const OBSIDIAN = "#11110F";
const IVORY = "#F5F2EB";
const SANDSTONE = "#C9C0B2";

/** @typedef {{ inner: string, width: number, height: number }} Mark */

/**
 * The inner markup and box of a brand SVG, to place inside a larger drawing.
 * @param {string} path
 * @returns {Mark}
 */
function brandSvg(path) {
  const svg = readFileSync(join(brand, path), "utf8");
  const box = /viewBox="([\d.\s-]+)"/.exec(svg)?.[1]?.split(/\s+/).map(Number);
  const inner = svg
    .replace(/^<svg[^>]*>/, "")
    .replace(/<\/svg>\s*$/, "")
    .replace(/<title>.*?<\/title>/, "");
  if (box === undefined || box.length !== 4) throw new Error(`no viewBox in ${path}`);
  return { inner, width: box[2] ?? 0, height: box[3] ?? 0 };
}

/**
 * Places a brand mark centred in a box of the drawing at the given height.
 * @param {Mark} mark
 * @param {number} centreX
 * @param {number} top
 * @param {number} height
 */
function place(mark, centreX, top, height) {
  const scale = height / mark.height;
  const x = centreX - (mark.width * scale) / 2;
  return `<g transform="translate(${x.toFixed(2)} ${String(top)}) scale(${scale.toFixed(5)})">${mark.inner}</g>`;
}

/**
 * @param {string} name
 * @param {number} width
 * @param {number} height
 * @param {string} body
 */
async function write(name, width, height, body) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${String(width)}" height="${String(height)}" viewBox="0 0 ${String(width)} ${String(height)}">${body}</svg>`;
  await sharp(Buffer.from(svg), { density: 144 })
    .resize(width * 2, height * 2)
    .png({ compressionLevel: 9 })
    .toFile(join(out, `${name}.png`));
  console.log(`email-art: ${name}.png ${String(width * 2)}x${String(height * 2)}`);
}

const stacked = brandSvg("lockup/lockup-stacked-bone.svg");
const emblemBone = brandSvg("emblem/emblem-bone.svg");

// 1. The masthead: a 600 x 240 Obsidian band, the stacked lockup in Bone, a Sandstone hairline near the foot with a
//    short gap under the mark, the way the site's footer sets the emblem on a line across the page.
await write(
  "masthead",
  600,
  240,
  `<rect width="600" height="240" fill="${OBSIDIAN}"/>` +
    place(stacked, 300, 38, 136) +
    `<path d="M48 206 H262 M338 206 H552" stroke="${SANDSTONE}" stroke-width="0.8" opacity="0.55"/>` +
    `<rect x="296" y="202" width="8" height="8" transform="rotate(45 300 206)" fill="none" stroke="${SANDSTONE}" stroke-width="0.8" opacity="0.8"/>`,
);

// 2. The ornament between sections: two hairlines and a diamond, on Ivory.
await write(
  "ornament",
  600,
  32,
  `<rect width="600" height="32" fill="${IVORY}"/>` +
    `<path d="M220 16 H288 M312 16 H380" stroke="${SANDSTONE}" stroke-width="1"/>` +
    `<rect x="295.5" y="11.5" width="9" height="9" transform="rotate(45 300 16)" fill="none" stroke="${SANDSTONE}" stroke-width="1"/>`,
);

// 3. The footer's emblem, Bone on Obsidian.
await write(
  "emblem",
  48,
  54,
  `<rect width="48" height="54" fill="${OBSIDIAN}"/>` + place(emblemBone, 24, 4, 46),
);
