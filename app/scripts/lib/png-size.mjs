// Width and height of a PNG (IHDR) or a JPEG (SOF0, SOF1 or SOF2) from its header bytes, no dependency.
// CLI: `node scripts/lib/png-size.mjs <file>...` prints `<w>x<h>` per file.
import { readFileSync } from "node:fs";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47];
const SOF_MARKERS = [0xc0, 0xc1, 0xc2];

/**
 * @param {Uint8Array} bytes
 * @returns {{ width: number, height: number }}
 */
export function imageSize(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (PNG_SIGNATURE.every((byte, at) => bytes[at] === byte)) {
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error("imageSize: not a PNG or a JPEG");
  let at = 2;
  while (at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) throw new Error("imageSize: broken JPEG marker");
    const marker = bytes[at + 1] ?? 0;
    if (SOF_MARKERS.includes(marker)) {
      return { width: view.getUint16(at + 7), height: view.getUint16(at + 5) };
    }
    at += 2 + view.getUint16(at + 2);
  }
  throw new Error("imageSize: no JPEG frame header found");
}

if (import.meta.main) {
  for (const file of process.argv.slice(2)) {
    const { width, height } = imageSize(readFileSync(file));
    console.log(`${String(width)}x${String(height)}`);
  }
}
