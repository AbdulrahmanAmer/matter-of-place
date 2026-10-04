// Job type `render_og_static`: the 1200x630 cards of the pages that are not a property (G5). Run by
// `scripts/render-job.mjs`, which uploads each card to `og/static/<key>.<hash8>.png` in the public `media` bucket, or by
// hand as `bun scripts/render-og-static.mjs --out <dir>`, which writes `<dir>/<key>.png` with no hash, no network and no
// upload: that is how the committed `public/og/static` set is made. The cards are flat, so they stay PNG.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { createElement } from "react";
import { z } from "zod";
import { ogStaticKeys } from "../src/domain/assets.ts";
import { OgCard } from "../src/templates/social/OgCard.tsx";
import { hash8 } from "./lib/media-key.mjs";
import { putIfMissing } from "./lib/media-store.mjs";
import { shoot } from "./lib/shoot.mjs";

const SIZE = { width: 1200, height: 630 };

/** The two lines of each card: the small line above and the large serif line. */
const CARDS = {
  home: {
    kicker: "California, New York and Florida",
    title: "Exceptional property. Properly considered.",
  },
  markets: { kicker: "Markets", title: "California, New York and Florida" },
  "market-california": { kicker: "Market", title: "California" },
  "market-new-york": { kicker: "Market", title: "New York" },
  "market-florida": { kicker: "Market", title: "Florida" },
  stories: { kicker: "Stories", title: "Architecture, interiors and places" },
  default: { kicker: "Editorial real estate", title: "Selected property, properly considered" },
};

const jobSchema = z.object({
  payload: z.object({
    params: z.object({ pages: z.array(z.enum(ogStaticKeys)).optional() }).default({}),
  }),
});

/**
 * @param {unknown} job `{ payload: { params: { pages? } } }`; no `pages` means all seven cards
 * @param {{ out?: string }} [options] `out` is a folder: the cards are written there and nothing is uploaded
 * @returns {Promise<{ files: { key: string, media_key: string, w: number, h: number }[] }>}
 */
export async function run(job, options) {
  const { pages = ogStaticKeys } = jobSchema.parse(job).payload.params;
  const shots = await shoot(
    pages.map((key) => ({
      name: key,
      role: "main",
      type: /** @type {const} */ ("png"),
      size: SIZE,
      element: createElement(OgCard, { variant: "default", ...CARDS[key] }),
    })),
  );
  if (options?.out !== undefined) await mkdir(options.out, { recursive: true });
  const files = [];
  for (const { frame, body } of shots) {
    const key = frame.name;
    const mediaKey = `og/static/${key}.${hash8(body)}.png`;
    if (options?.out === undefined) {
      await putIfMissing("media", mediaKey, body, "image/png");
    } else {
      await writeFile(join(options.out, `${key}.png`), body);
    }
    files.push({ key, media_key: mediaKey, w: SIZE.width, h: SIZE.height });
  }
  return { files };
}

if (import.meta.main) {
  try {
    const { values } = parseArgs({ options: { out: { type: "string" } } });
    if (values.out === undefined) throw new Error("render-og-static: run it as --out <dir>");
    const { files } = await run({ payload: { params: {} } }, { out: values.out });
    for (const file of files) console.log(`${file.key} ${String(file.w)}x${String(file.h)} ok`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
