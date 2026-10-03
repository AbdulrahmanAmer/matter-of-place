// The image library (B2 step 12): makeVariants, variantKeys and MediaVariants. The CLI is step 13.
import { createHash } from "node:crypto";
import sharp, { type Sharp } from "sharp";
import { uploadLimits } from "../src/domain/contracts.ts";
import { heicToJpeg } from "./lib/heic.ts";
import { stripExif } from "./lib/strip-exif.ts";

interface Sized {
  w: number;
  h: number;
}

/** The shape of `property_media.variants` and of the `image_variants` of markets, regions and stories (G59). */
export interface MediaVariants {
  thumb: Sized & { webp: string };
  card: Sized & { webp: string };
  hero: Sized & { webp: string };
  og: Sized & { jpg: string };
  carousel: Sized & { jpg: string };
}

export type VariantName = keyof MediaVariants;

export interface VariantFile extends Sized {
  body: Buffer;
  type: "image/webp" | "image/jpeg";
}

export interface MadeVariants {
  /** The EXIF-stripped WebP master, the source of every variant and the bytes behind `sha8`. */
  master: Buffer;
  /** The first eight hex digits of the master's SHA-256. */
  sha8: string;
  files: Record<VariantName, VariantFile>;
}

const WIDTHS = { thumb: 320, card: 720, hero: 1600 } as const;
// Open Graph readers and Meta publishing take JPEG, so these two stay JPEG (ruling H33 (8)).
const OG = { width: 1200, height: 630 } as const;
const CAROUSEL = { width: 1080, height: 1350 } as const;
const EXTENSIONS: Record<VariantName, "webp" | "jpg"> = {
  thumb: "webp",
  card: "webp",
  hero: "webp",
  og: "jpg",
  carousel: "jpg",
};

/** The `<sha8>` of a key: the first eight hex digits of the stripped master's SHA-256. */
export function sha8Of(master: Uint8Array): string {
  return createHash("sha256").update(master).digest("hex").slice(0, 8);
}

async function encode(pipeline: Sharp, type: VariantFile["type"]): Promise<VariantFile> {
  const encoded =
    type === "image/webp" ? pipeline.webp({ quality: 80 }) : pipeline.jpeg({ quality: 85 });
  const { data, info } = await encoded.toBuffer({ resolveWithObject: true });
  return { body: data, type, w: info.width, h: info.height };
}

/**
 * Strips the upload (HEIC converted to JPEG first) and renders all five sizes from the stripped master (GP-04, GQ-07).
 * It always renders all five, so a stored `variants` value other than `{}` is a complete `MediaVariants`.
 */
export async function makeVariants(buffer: Uint8Array, mime: string): Promise<MadeVariants> {
  if (!uploadLimits.types.some((accepted) => accepted === mime)) {
    throw new Error(`makeVariants: unsupported image type ${mime}`);
  }
  const heic = mime === "image/heic";
  const master = await stripExif(
    heic ? await heicToJpeg(buffer) : buffer,
    heic ? "image/jpeg" : mime,
  );
  const from = () => sharp(master);
  const [thumb, card, hero, og, carousel] = await Promise.all([
    encode(from().resize({ width: WIDTHS.thumb, withoutEnlargement: true }), "image/webp"),
    encode(from().resize({ width: WIDTHS.card, withoutEnlargement: true }), "image/webp"),
    encode(from().resize({ width: WIDTHS.hero, withoutEnlargement: true }), "image/webp"),
    encode(from().resize({ ...OG, fit: "cover" }), "image/jpeg"),
    encode(from().resize({ ...CAROUSEL, fit: "cover" }), "image/jpeg"),
  ]);
  return { master, sha8: sha8Of(master), files: { thumb, card, hero, og, carousel } };
}

/**
 * Every key a photograph owns in the `media` bucket. `owner` is the property slug for property media and the row's own
 * slug for markets, regions, representatives and stories, fixed at upload; a key never moves.
 */
export function variantKeys(
  owner: string,
  n: number,
  sha8: string,
): Record<"master" | VariantName, string> {
  const stem = `${String(n)}-${sha8}`;
  const variant = (name: VariantName) => `v/${owner}/${stem}/${name}.${EXTENSIONS[name]}`;
  return {
    master: `o/${owner}/${stem}.webp`,
    thumb: variant("thumb"),
    card: variant("card"),
    hero: variant("hero"),
    og: variant("og"),
    carousel: variant("carousel"),
  };
}
