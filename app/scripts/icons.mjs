// `bun run icons`: draws the icon set from `public/favicon.svg`, the brand emblem, in its light colours (the
// `prefers-color-scheme: dark` block of the file is for browser tabs and is not drawn). Writes `favicon.ico` (16, 32
// and 48 pixels), `apple-touch-icon.png` (180), `icon-192.png`, `icon-512.png`, `mstile-150.png` and
// `maskable-512.png` (the emblem inside the central 80 percent, which a launcher's mask may cut to a circle) into
// `public`. The two files that existed before this script (`favicon.ico`, `apple-touch-icon.png`) come out byte for
// byte as committed. Run by hand when the emblem changes and commit the output in the same commit.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const PUBLIC = join(fileURLToPath(new URL("../", import.meta.url)), "public");
const SAFE_ZONE = 0.8;

const emblem = readFileSync(join(PUBLIC, "favicon.svg"), "utf8");
const inner = emblem.slice(emblem.indexOf(">") + 1, emblem.lastIndexOf("</svg>"));
const fill = /\.bg\{fill:(#[0-9A-Fa-f]{6})\}/.exec(emblem)?.[1];
if (fill === undefined) throw new Error("public/favicon.svg has no .bg fill");
const origin = String(32 * (1 - SAFE_ZONE));
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${fill}"/><g transform="translate(${origin} ${origin}) scale(${String(SAFE_ZONE)})">${inner}</g></svg>`;

/**
 * @param {string} svg
 * @param {number} size edge in pixels
 * @returns {Promise<Buffer>}
 */
const png = (svg, size) =>
  sharp(Buffer.from(svg), { density: 4.5 * size })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toBuffer();

/**
 * @param {readonly Buffer[]} images square PNG files, 16 to 255 pixels, in ascending size
 * @returns {Buffer} an ICO file that holds each PNG as it is
 */
function ico(images) {
  const head = Buffer.alloc(6 + 16 * images.length);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(images.length, 4);
  let offset = head.length;
  images.forEach((image, index) => {
    const at = 6 + 16 * index;
    const edge = image.readUInt32BE(16);
    head.writeUInt8(edge, at);
    head.writeUInt8(edge, at + 1);
    head.writeUInt16LE(1, at + 4);
    head.writeUInt16LE(32, at + 6);
    head.writeUInt32LE(image.length, at + 8);
    head.writeUInt32LE(offset, at + 12);
    offset += image.length;
  });
  return Buffer.concat([head, ...images]);
}

/** @type {readonly (readonly [string, Buffer])[]} */
const files = [
  ["favicon.ico", ico(await Promise.all([16, 32, 48].map((size) => png(emblem, size))))],
  ["apple-touch-icon.png", await png(emblem, 180)],
  ["icon-192.png", await png(emblem, 192)],
  ["icon-512.png", await png(emblem, 512)],
  ["mstile-150.png", await png(emblem, 150)],
  ["maskable-512.png", await png(maskable, 512)],
];
for (const [name, bytes] of files) {
  writeFileSync(join(PUBLIC, name), bytes);
  process.stdout.write(`${name} ${String(bytes.length)}\n`);
}
