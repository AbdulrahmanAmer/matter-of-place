// Prepares each photograph in the browser before `POST /submissions` (PERF-08, rulings H21 and H33 (8)), so the
// declared `type` and `size` are those of the file that is sent.

/** The longest edge an original keeps: the largest variant ever stored, so more would only cost Storage space. */
export const MAX_UPLOAD_EDGE = 2560;
const THUMB_EDGE = 480;
const THUMB_QUALITY = 0.8;
const ORIGINAL_QUALITY = 0.9;

export interface PreparedImage {
  original: Blob;
  type: string;
  /** Null when the browser cannot decode the file (HEIC in Chrome); screen 3 then shows a placeholder. */
  thumb: Blob | null;
}

/** The size that fits `maxEdge` on the long edge, keeping the proportions; a smaller image keeps its size. */
export function fitWithin(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } {
  const longEdge = Math.max(width, height);
  if (longEdge <= maxEdge) return { width, height };
  const scale = maxEdge / longEdge;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

async function toJpeg(bitmap: ImageBitmap, maxEdge: number, quality: number): Promise<Blob> {
  const { width, height } = fitWithin(bitmap.width, bitmap.height, maxEdge);
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("No 2d context on OffscreenCanvas");
  context.drawImage(bitmap, 0, 0, width, height);
  return canvas.convertToBlob({ type: "image/jpeg", quality });
}

/**
 * A 480 px JPEG thumbnail, and the original re-encoded to a 2560 px JPEG when its long edge is larger. A file at or
 * under 2560 px goes as it is, so its colour profile is kept. A file the browser cannot decode or draw goes as it
 * is, without a thumbnail.
 */
export async function prepareImage(file: File): Promise<PreparedImage> {
  const unchanged: PreparedImage = { original: file, type: file.type, thumb: null };
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return unchanged;
  }
  try {
    const thumb = await toJpeg(bitmap, THUMB_EDGE, THUMB_QUALITY);
    if (Math.max(bitmap.width, bitmap.height) <= MAX_UPLOAD_EDGE) return { ...unchanged, thumb };
    return {
      original: await toJpeg(bitmap, MAX_UPLOAD_EDGE, ORIGINAL_QUALITY),
      type: "image/jpeg",
      thumb,
    };
  } catch {
    return unchanged;
  } finally {
    bitmap.close();
  }
}
