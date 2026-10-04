// Job type `render_variants`: the stripped master and the five sizes of each staged photograph, uploaded to the
// public `media` bucket under B2's `variantKeys` scheme. Run by `scripts/render-job.mjs`, or by hand as
// `bun scripts/render-variants.mjs --file <image> --out <dir>` (no network, nothing uploaded).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { parseArgs } from "node:util";
import sharp from "sharp";
import { z } from "zod";
import { NAMES, makeVariants, storeVariants, variantFiles, variantKeys } from "./variants.ts";

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
    const made = await makeVariants(original, item.mime);
    media[item.media_id] = await storeVariants(made, variantKeys(item.owner, item.n, made.sha8));
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
  const made = await makeVariants(await readFile(file), mime);
  const keys = variantKeys("local", 0, made.sha8);
  for (const { key, body } of variantFiles(made, keys).files) {
    await mkdir(dirname(join(out, key)), { recursive: true });
    await writeFile(join(out, key), body);
  }
  const master = await sharp(made.master).metadata();
  console.log(
    `original ${String(master.width)}x${String(master.height)} ${String(made.master.length)} bytes ${keys.master}`,
  );
  for (const name of NAMES) {
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
