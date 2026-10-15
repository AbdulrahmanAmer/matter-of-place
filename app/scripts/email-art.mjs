// `node scripts/email-art.mjs`: draws the artwork of the emails as SVG and writes it as PNG to public/email/
// (operator, 2026-10-12: "go all out on the emails, custom SVGs"). Mail clients strip inline SVG (Gmail, Outlook),
// so the SVG is rendered here, at two or three times its display size, and the emails show the PNG from
// matterofplace.com. The marks come from the outlined logos of ../brand (no font needed to render them). Run it after a
// brand change and commit the PNGs; nothing renders at send time.
//
// Since the redesign of 2026-10-15 an email draws one picture of the brand: the emblem and the wordmark side by side in
// its running header, as the brand's horizontal lockup sets them. Both carry the Ivory of the page as their ground
// instead of transparency: a client that darkens the page (Gmail's dark mode) never darkens a picture, and an Obsidian
// mark on a transparent ground would vanish into it. The masthead, ornament and emblem of the 2026-10-12 shell are still
// written, unchanged, because mail already sent shows them from the same addresses.
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
 * Places the part of a mark that lies inside `content` (in the mark's own units) at `left`, `top`, `height`.
 * @param {Mark} mark
 * @param {{ x: number, y: number, height: number }} content
 * @param {number} left
 * @param {number} top
 * @param {number} height
 */
function placeContent(mark, content, left, top, height) {
  const scale = height / content.height;
  const x = left - content.x * scale;
  const y = top - content.y * scale;
  return `<g transform="translate(${x.toFixed(3)} ${y.toFixed(3)}) scale(${scale.toFixed(5)})">${mark.inner}</g>`;
}

/**
 * @param {string} name
 * @param {number} width
 * @param {number} height
 * @param {string} body
 * @param {number} [density] pixels per display pixel
 */
async function write(name, width, height, body, density = 2) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${String(width)}" height="${String(height)}" viewBox="0 0 ${String(width)} ${String(height)}">${body}</svg>`;
  await sharp(Buffer.from(svg), { density: 72 * density })
    .resize(width * density, height * density)
    .png({ compressionLevel: 9 })
    .toFile(join(out, `${name}.png`));
  console.log(`email-art: ${name}.png ${String(width * density)}x${String(height * density)}`);
}

const emblemObsidian = brandSvg("emblem/emblem-obsidian.svg");
const wordmarkObsidian = brandSvg("wordmark/wordmark-horizontal-obsidian.svg");

// The running header, drawn at three times its size for phone screens. The emblem's two planes fill x 8 to 60 and
// y 5 to 70 of its 76-unit box; the wordmark's letters fill its whole box. At the header's 10 px wordmark the emblem is
// 28 px, 2.8 times the letters, the ratio of the brand's horizontal lockup. The wordmark sits 3 px inside a 16 px
// strip, tall enough for its alt text when a client shows that instead. `layout.tsx` draws both at these sizes.
const LOCKUP = {
  emblem: { width: 23, height: 28 },
  wordmark: { width: 150, height: 16, inset: 3, letters: 10 },
};

await write(
  "lockup-emblem",
  LOCKUP.emblem.width,
  LOCKUP.emblem.height,
  `<rect width="${String(LOCKUP.emblem.width)}" height="${String(LOCKUP.emblem.height)}" fill="${IVORY}"/>` +
    placeContent(emblemObsidian, { x: 8, y: 5, height: 65 }, 0.3, 0, LOCKUP.emblem.height),
  3,
);

await write(
  "lockup-wordmark",
  LOCKUP.wordmark.width,
  LOCKUP.wordmark.height,
  `<rect width="${String(LOCKUP.wordmark.width)}" height="${String(LOCKUP.wordmark.height)}" fill="${IVORY}"/>` +
    placeContent(
      wordmarkObsidian,
      { x: 0, y: 0, height: wordmarkObsidian.height },
      0.4,
      LOCKUP.wordmark.inset,
      LOCKUP.wordmark.letters,
    ),
  3,
);

// The 2026-10-12 shell, kept for mail already sent (see the head of this file).
const stacked = brandSvg("lockup/lockup-stacked-bone.svg");
const emblemBone = brandSvg("emblem/emblem-bone.svg");

await write(
  "masthead",
  600,
  240,
  `<rect width="600" height="240" fill="${OBSIDIAN}"/>` +
    place(stacked, 300, 38, 136) +
    `<path d="M48 206 H262 M338 206 H552" stroke="${SANDSTONE}" stroke-width="0.8" opacity="0.55"/>` +
    `<rect x="296" y="202" width="8" height="8" transform="rotate(45 300 206)" fill="none" stroke="${SANDSTONE}" stroke-width="0.8" opacity="0.8"/>`,
);

await write(
  "ornament",
  600,
  32,
  `<rect width="600" height="32" fill="${IVORY}"/>` +
    `<path d="M220 16 H288 M312 16 H380" stroke="${SANDSTONE}" stroke-width="1"/>` +
    `<rect x="295.5" y="11.5" width="9" height="9" transform="rotate(45 300 16)" fill="none" stroke="${SANDSTONE}" stroke-width="1"/>`,
);

await write(
  "emblem",
  48,
  54,
  `<rect width="48" height="54" fill="${OBSIDIAN}"/>` + place(emblemBone, 24, 4, 46),
);
