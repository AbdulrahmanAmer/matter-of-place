// Job type `render_variants`: the stripped master and the five sizes of each staged photograph, uploaded to the
// public `media` bucket under B2's `variantKeys` scheme. Run by `scripts/render-job.mjs`, or by hand as
// `bun scripts/render-variants.mjs --file <image> --out <dir>` (no network, nothing uploaded).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { parseArgs } from "node:util";
import sharp from "sharp";
import { z } from "zod";
import { putIfMissing } from "./lib/media-store.mjs";
import { makeVariants, variantKeys } from "./variants.ts";

/** @type {readonly ("thumb" | "card" | "hero" | "og" | "carousel")[]} */
const SIZES = ["thumb", "card", "hero", "og", "carousel"];
const MIME_OF = new Map([
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
  [".heic", "image/heic"],
]);

const jobSchema = z.object({
  payload: z.object({
    data: z.object({
      media: z.array(
        z.object({
          media_id: z.string(),
          staged_url: z.string(),
          mime: z.string(),
          owner: z.string(),
          n: z.number().int(),
        }),
      ),
    }),
  }),
});

/**
 * The stripped master and the five sizes with the key each is stored under.
 * @param {Uint8Array} original
 * @param {string} mime
 * @param {string} owner
 * @param {number} n
 */
async function render(original, mime, owner, n) {
  const made = await makeVariants(original, mime);
  const keys = variantKeys(owner, n, made.sha8);
  const files = [
    { key: keys.master, body: made.master, type: "image/webp" },
    ...SIZES.map((name) => ({
      key: keys[name],
      body: made.files[name].body,
      type: made.files[name].type,
    })),
  ];
  const variants = Object.fromEntries(
    SIZES.map((name) => [name, { w: made.files[name].w, h: made.files[name].h }]),
  );
  return { made, keys, files, variants };
}

/**
 * @param {unknown} job `{ payload: { data: { media: [{ media_id, staged_url, mime, owner, n }] } } }`
 * @returns {Promise<{ media: Record<string, { media_key: string, variants: Record<string, { w: number, h: number }> }> }>}
 */
export async function run(job) {
  /** @type {Record<string, { media_key: string, variants: Record<string, { w: number, h: number }> }>} */
  const media = {};
  for (const item of jobSchema.parse(job).payload.data.media) {
    const response = await fetch(item.staged_url);
    if (response.status !== 200) {
      throw new Error(
        `render_variants: the staged original of ${item.media_id} answered ${String(response.status)}`,
      );
    }
    const original = new Uint8Array(await response.arrayBuffer());
    const { keys, files, variants } = await render(original, item.mime, item.owner, item.n);
    await Promise.all(files.map((file) => putIfMissing("media", file.key, file.body, file.type)));
    media[item.media_id] = { media_key: keys.master, variants };
  }
  return { media };
}

/**
 * @param {string} file
 * @param {string} out
 * @returns {Promise<void>}
 */
async function runLocal(file, out) {
  const mime = MIME_OF.get(extname(file).toLowerCase());
  if (mime === undefined) throw new Error(`render_variants: unsupported file type ${file}`);
  const { made, keys, files } = await render(await readFile(file), mime, "local", 0);
  for (const { key, body } of files) {
    await mkdir(dirname(join(out, key)), { recursive: true });
    await writeFile(join(out, key), body);
  }
  const master = await sharp(made.master).metadata();
  console.log(
    `original ${String(master.width)}x${String(master.height)} ${String(made.master.length)} bytes ${keys.master}`,
  );
  for (const name of SIZES) {
    const { w, h, body } = made.files[name];
    console.log(`${name} ${String(w)}x${String(h)} ${String(body.length)} bytes ${keys[name]}`);
  }
}

if (import.meta.main) {
  try {
    const { values } = parseArgs({
      options: { file: { type: "string" }, out: { type: "string" } },
    });
    if (values.file === undefined || values.out === undefined) {
      throw new Error("render-variants: run it as --file <image> --out <dir>");
    }
    await runLocal(values.file, values.out);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
