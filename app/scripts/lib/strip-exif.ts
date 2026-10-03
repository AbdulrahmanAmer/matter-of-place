import sharp from "sharp";

/** The largest stored image: its long edge in pixels (ruling H33 (8), PERF-08). */
const MASTER_EDGE = 2560;
const MASTER_QUALITY = 90;
/** HEIC is converted to JPEG before this function (`heicToJpeg`), because sharp's libvips does not decode it. */
const READABLE_TYPES = ["image/jpeg", "image/png", "image/webp"];

/**
 * The stored master of a photograph (GP-04): orientation applied, fitted inside 2560 px, re-encoded as WebP without
 * metadata, so the GPS of a private residence never ships. Every variant is made from this buffer, never from the
 * upload.
 */
export async function stripExif(buffer: Uint8Array, mime: string): Promise<Buffer> {
  if (!READABLE_TYPES.includes(mime)) throw new Error(`stripExif: unsupported image type ${mime}`);
  return sharp(buffer)
    .rotate()
    .resize({ width: MASTER_EDGE, height: MASTER_EDGE, fit: "inside", withoutEnlargement: true })
    .webp({ quality: MASTER_QUALITY })
    .toBuffer();
}
