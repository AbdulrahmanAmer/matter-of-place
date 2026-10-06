// The reel's poster (B12): the frame at 2.4 s as a JPEG of quality 90, the Instagram `cover_url` and the dossier
// poster. ffmpeg cuts the frame as PNG, sharp writes the JPEG, because ffmpeg's JPEG encoder has no 0 to 100 scale.
import { spawnSync } from "node:child_process";
import sharp from "sharp";

/**
 * @param {string} mp4
 * @returns {Promise<Buffer>} the JPEG bytes
 */
export async function extractPoster(mp4) {
  const frame = spawnSync(
    "ffmpeg",
    [
      ...["-v", "error", "-ss", "2.4", "-i", mp4],
      ...["-frames:v", "1", "-f", "image2pipe", "-c:v", "png", "-"],
    ],
    { maxBuffer: 1 << 26 },
  );
  if (frame.status !== 0) {
    throw new Error(
      `reel-poster: ffmpeg exited ${String(frame.status)}: ${frame.stderr.toString()}`,
    );
  }
  return sharp(frame.stdout).jpeg({ quality: 90 }).toBuffer();
}
