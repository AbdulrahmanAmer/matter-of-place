// The image library (B2 step 12) and its CLI (step 13): makeVariants, variantKeys and MediaVariants.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { parseArgs } from "node:util";
import sharp, { type Sharp } from "sharp";
import { uploadLimits } from "../src/domain/contracts.ts";
import { heicToJpeg } from "./lib/heic.ts";
import { stripExif } from "./lib/strip-exif.ts";

interface Sized {
  w: number;
  h: number;
}

/**
 * The shape of `property_media.variants` and of the `image_variants` of markets, regions and stories (G59): the size
 * of each rendition and nothing else. The keys come from `variantKeys` and the content hash is already in the
 * stored master key `o/<owner>/<n>-<sha8>.webp`, so the snapshot stays under its budget (PERF-03) and B3 derives the
 * address of every size from the master key.
 */
export type MediaVariants = Record<"thumb" | "card" | "hero" | "og" | "carousel", Sized>;

type VariantName = keyof MediaVariants;

interface VariantFile extends Sized {
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
const NAMES: readonly VariantName[] = ["thumb", "card", "hero", "og", "carousel"];
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

export type VariantsArgs =
  | { mode: "file"; file: string; owner: string }
  | { mode: "property"; property: string }
  | { mode: "all" };

/** `--file <path> --owner <id>`, `--property <uuid>` or `--all`; exactly one mode. A leading `--` is ignored. */
export function parseVariantsArgs(argv: readonly string[]): VariantsArgs {
  const { values } = parseArgs({
    args: argv[0] === "--" ? argv.slice(1) : [...argv],
    options: {
      file: { type: "string" },
      owner: { type: "string" },
      property: { type: "string" },
      all: { type: "boolean" },
    },
  });
  const modes = [values.file, values.property, values.all].filter((mode) => mode !== undefined);
  if (modes.length !== 1)
    throw new Error("variants: give exactly one of --file, --property, --all");
  if (values.file !== undefined) {
    if (values.owner === undefined) throw new Error("variants: --file needs --owner");
    return { mode: "file", file: values.file, owner: values.owner };
  }
  return values.property === undefined
    ? { mode: "all" }
    : { mode: "property", property: values.property };
}

const MIME_OF: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".heic": "image/heic",
};

/** Makes the variants of one local file and prints one line per key; it writes and sends nothing. */
async function printKeys(file: string, owner: string): Promise<void> {
  const mime = MIME_OF[extname(file).toLowerCase()];
  if (mime === undefined) throw new Error(`variants: unsupported file type ${file}`);
  const made = await makeVariants(await readFile(file), mime);
  const keys = variantKeys(owner, 0, made.sha8);
  console.log(`${keys.master}  ${String(made.master.length)} bytes`);
  for (const name of NAMES) {
    const { w, h, body } = made.files[name];
    console.log(`${keys[name]}  ${String(w)}x${String(h)}  ${String(body.length)} bytes`);
  }
}

async function main(): Promise<void> {
  const args = parseVariantsArgs(process.argv.slice(2));
  if (args.mode === "file") return printKeys(args.file, args.owner);
  // STUB(B9): upload each variant with putIfMissing from scripts/lib/media-store.mjs and write property_media.variants
  throw new Error("variants: --property and --all wait for B9's scripts/lib/media-store.mjs");
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
