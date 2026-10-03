// The content-hashed key of a rendered file in the public `media` bucket (architecture 13 layer Media, F24).
import { createHash } from "node:crypto";

/**
 * @param {Uint8Array} bytes
 * @returns {string} the first 8 hex digits of the SHA-256 of the bytes
 */
export function hash8(bytes) {
  return createHash("sha256").update(bytes).digest("hex").slice(0, 8);
}

/**
 * `assets/<propertyId>/<kind>/r<revision>/<name>.<hash8>.<ext>`: the same bytes always give the same key and a
 * changed file gives a new one, so a key is never overwritten.
 * @param {{ propertyId: string, kind: string, revision: number, name: string, bytes: Uint8Array, ext?: string }} file
 * @returns {string}
 */
export function mediaKey({ propertyId, kind, revision, name, bytes, ext = "png" }) {
  return `assets/${propertyId}/${kind}/r${String(revision)}/${name}.${hash8(bytes)}.${ext}`;
}
