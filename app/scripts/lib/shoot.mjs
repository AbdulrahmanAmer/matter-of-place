// The shared part of the three render scripts (B9): the job's spec, the photographs inlined as data URLs, a browser
// that screenshots each frame at its exact size, and the JPEG files named by `mediaKey` and written to `--out` or
// uploaded to the public `media` bucket. The page holds only data URLs: every other request is refused (invariant 2).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import puppeteer from "puppeteer-core";
import { renderToStaticMarkup } from "react-dom/server";
import { z } from "zod";
import { mediaKey } from "./media-key.mjs";
import { putIfMissing } from "./media-store.mjs";
import { imageSize } from "./png-size.mjs";

const APP = fileURLToPath(new URL("../../", import.meta.url));
const FONT_FAMILIES = ["Jost", "Cormorant Garamond"];
const JPEG_QUALITY = 92;
const IMAGE_TYPES = new Map([
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
]);

const imageSchema = z.object({
  url: z.string(),
  alt: z.string(),
  orientation: z.enum(["landscape", "portrait"]),
  w: z.number(),
  h: z.number(),
});
const propertySchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  city: z.string(),
  state: z.string(),
  market: z.string(),
  price: z.number(),
  currency: z.string(),
  beds: z.number(),
  baths: z.number(),
  interiorSqFt: z.number(),
  yearBuilt: z.number(),
  type: z.string(),
  place: z.string().default(""),
});
const slideSchema = z.union([
  z.object({ kind: z.enum(["cover", "photo", "facts", "close"]), image: z.number().int() }),
  z.object({ kind: z.literal("place"), image: z.number().int(), text: z.string() }),
]);
const specSchema = z.object({
  kind: z.enum(["cover", "carousel", "story"]),
  property: propertySchema,
  images: z.array(imageSchema),
  slides: z.array(slideSchema).optional(),
  out: z.object({ key_prefix: z.string().regex(/^assets\/[^/]+\/[^/]+\/r\d+\/$/) }),
});
const engineSchema = z.object({ findChrome: z.function().returns(z.string()) });
const jobSchema = z.object({ payload: z.object({ data: z.object({ spec: specSchema }) }) });
const fixtureSchema = z.object({
  property: propertySchema,
  images: z.array(imageSchema.omit({ url: true }).extend({ path: z.string() })),
});

/** @typedef {z.infer<typeof specSchema>} RenderSpec */
/** @typedef {{ out?: string }} RenderOptions `out` is a folder: files are written there and nothing is uploaded. */
/** @typedef {{ role: string, index?: number, media_key: string, w: number, h: number, bytes: number }} RenderedFile */
/**
 * @typedef {object} Frame
 * @property {string} name file name before the hash, for example `cover-x`
 * @property {string} role the `role` of the stored file
 * @property {number} [index]
 * @property {{ width: number, height: number }} size the size the file promises, checked on the frame and on the file
 * @property {{ width: number, height: number }} [viewport] the browser window, `size` unless the frame is clipped
 * @property {{ x: number, y: number }} [clip] where the file of `size` starts inside the viewport
 * @property {import("react").ReactElement} element
 */

/**
 * @param {string} path under the app folder
 * @returns {Promise<string>}
 */
function readText(path) {
  return readFile(join(APP, path), "utf8");
}

/** @returns {Promise<string>} tokens, the faces as data URLs and the social stylesheet, as one block */
async function pageCss() {
  const [tokens, faces, social] = await Promise.all([
    readText("src/styles/tokens.css"),
    readText("src/templates/social/fonts.css"),
    readText("src/templates/social/social.css"),
  ]);
  const files = [...faces.matchAll(/url\("\/fonts\/([^"]+)"\)/g)].map((match) => match[1] ?? "");
  const fonts = new Map(
    await Promise.all(
      files.map(async (file) => {
        const bytes = await readFile(join(APP, "public/fonts", file));
        return /** @type {const} */ ([file, bytes.toString("base64")]);
      }),
    ),
  );
  const inlined = faces.replace(
    /url\("\/fonts\/([^"]+)"\)/g,
    (_match, file) => `url("data:font/woff2;base64,${fonts.get(String(file)) ?? ""}")`,
  );
  return `body{margin:0}\n${tokens}\n${inlined}\n${social}`;
}

/** @returns {Promise<string>} Chrome from `CHROME_PATH`, else the cached one `findChrome()` returns on the laptop */
async function chromePath() {
  const fromEnv = process.env["CHROME_PATH"];
  if (fromEnv !== undefined && fromEnv !== "") return fromEnv;
  const enginePath = fileURLToPath(new URL("../../../launch/engine/chrome.mjs", import.meta.url));
  const engine = engineSchema.parse(
    await import(/* @vite-ignore */ pathToFileURL(enginePath).href),
  );
  return engine.findChrome();
}

// Runs in the page: both families loaded from their data URLs, every image decoded.
const READY = `(async () => {
  const families = ${JSON.stringify(FONT_FAMILIES)};
  await Promise.all(families.map((family) => document.fonts.load('400 16px "' + family + '"')));
  await document.fonts.ready;
  const loaded = new Set(
    Array.from(document.fonts)
      .filter((face) => face.status === "loaded")
      .map((face) => face.family.replaceAll('"', "")),
  );
  const brokenImages = [];
  await Promise.all(
    Array.from(document.images).map((image) => image.decode().catch(() => brokenImages.push(image.alt))),
  );
  const box = document.querySelector(".social-frame").getBoundingClientRect();
  return { missingFonts: families.filter((family) => !loaded.has(family)), brokenImages, frame: { width: box.width, height: box.height } };
})()`;
const readySchema = z.object({
  missingFonts: z.array(z.string()),
  brokenImages: z.array(z.string()),
  frame: z.object({ width: z.number(), height: z.number() }),
});

/**
 * @param {import("puppeteer-core").Browser} browser
 * @param {string} css
 * @param {Frame} frame
 * @returns {Promise<Buffer>} the JPEG, checked against the size the frame promises
 */
async function capture(browser, css, frame) {
  const page = await browser.newPage();
  try {
    /** @type {string[]} */
    const refused = [];
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      if (request.url().startsWith("data:")) {
        void request.continue();
        return;
      }
      refused.push(request.url());
      void request.abort();
    });
    await page.setViewport({ ...(frame.viewport ?? frame.size), deviceScaleFactor: 1 });
    const markup = renderToStaticMarkup(frame.element);
    await page.setContent(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${css}</style></head><body>${markup}</body></html>`,
      { waitUntil: "load" },
    );
    const {
      missingFonts,
      brokenImages,
      frame: box,
    } = readySchema.parse(await page.evaluate(READY));
    if (missingFonts.length > 0)
      throw new Error(`shoot: font not loaded: ${missingFonts.join(", ")}`);
    if (refused.length > 0) throw new Error(`shoot: ${frame.name} asked for ${String(refused[0])}`);
    if (brokenImages.length > 0)
      throw new Error(`shoot: image not decoded: ${brokenImages.join(", ")}`);
    const viewport = frame.viewport ?? frame.size;
    if (box.width !== viewport.width || box.height !== viewport.height) {
      throw new Error(
        `shoot: ${frame.name} frame is ${String(box.width)}x${String(box.height)}, the viewport ${String(viewport.width)}x${String(viewport.height)}`,
      );
    }
    const shot = await page.screenshot({
      type: "jpeg",
      quality: JPEG_QUALITY,
      ...(frame.clip === undefined ? {} : { clip: { ...frame.clip, ...frame.size } }),
    });
    const body = Buffer.from(shot);
    if (body[0] !== 0xff || body[1] !== 0xd8) throw new Error(`shoot: ${frame.name} is not a JPEG`);
    const got = imageSize(body);
    if (got.width !== frame.size.width || got.height !== frame.size.height) {
      throw new Error(
        `shoot: ${frame.name} is ${String(got.width)}x${String(got.height)}, expected ${String(frame.size.width)}x${String(frame.size.height)}`,
      );
    }
    return body;
  } finally {
    await page.close();
  }
}

/**
 * @param {Frame[]} frames
 * @returns {Promise<{ frame: Frame, body: Buffer }[]>}
 */
async function shoot(frames) {
  const css = await pageCss();
  const browser = await puppeteer.launch({
    executablePath: await chromePath(),
    headless: true,
    // The page holds our own markup and data URLs only; the runner's user namespaces refuse Chrome's sandbox.
    args: [
      "--no-sandbox",
      "--disable-gpu",
      "--hide-scrollbars",
      "--force-color-profile=srgb",
      "--font-render-hinting=none",
      "--force-device-scale-factor=1",
    ],
  });
  try {
    /** @type {{ frame: Frame, body: Buffer }[]} */
    const shots = [];
    for (const frame of frames) shots.push({ frame, body: await capture(browser, css, frame) });
    return shots;
  } finally {
    await browser.close();
  }
}

/**
 * @param {string} url an absolute address (upload mode) or a path under the app folder (fixture mode)
 * @returns {Promise<string>} the photograph as a data URL
 */
async function dataUrl(url) {
  if (/^https?:\/\//.test(url)) {
    const response = await fetch(url);
    if (response.status !== 200) {
      throw new Error(`shoot: image ${url} answered ${String(response.status)}`);
    }
    const type = response.headers.get("content-type") ?? "";
    return `data:${type};base64,${Buffer.from(await response.arrayBuffer()).toString("base64")}`;
  }
  const path = resolve(APP, url);
  const type = IMAGE_TYPES.get(extname(path).toLowerCase());
  if (type === undefined) throw new Error(`shoot: no image type for ${url}`);
  return `data:${type};base64,${(await readFile(path)).toString("base64")}`;
}

/**
 * @param {RenderSpec} spec
 * @param {{ frame: Frame, body: Buffer }[]} shots
 * @param {RenderOptions} options
 * @returns {Promise<RenderedFile[]>}
 */
async function deliver(spec, shots, options) {
  const revision = Number(/\/r(\d+)\/$/.exec(spec.out.key_prefix)?.[1]);
  /** @type {RenderedFile[]} */
  const files = [];
  for (const { frame, body } of shots) {
    const key = mediaKey({
      propertyId: spec.property.id,
      kind: spec.kind,
      revision,
      name: frame.name,
      bytes: body,
      ext: "jpg",
    });
    if (!key.startsWith(spec.out.key_prefix))
      throw new Error(`shoot: ${key} is outside ${spec.out.key_prefix}`);
    if (options.out === undefined) {
      await putIfMissing("media", key, body, "image/jpeg");
    } else {
      await mkdir(options.out, { recursive: true });
      await writeFile(join(options.out, basename(key)), body);
    }
    const { width, height } = frame.size;
    files.push({
      role: frame.role,
      ...(frame.index === undefined ? {} : { index: frame.index }),
      media_key: key,
      w: width,
      h: height,
      bytes: body.length,
    });
  }
  return files;
}

/**
 * The whole of one render script: read the spec, inline its photographs, shoot the frames the script plans and
 * deliver the files.
 * @param {unknown} job `{ payload: { data: { spec } } }`
 * @param {RenderOptions | undefined} options
 * @param {(spec: RenderSpec) => Frame[]} plan
 * @returns {Promise<{ files: RenderedFile[] }>}
 */
export async function renderSet(job, options, plan) {
  const { spec } = jobSchema.parse(job).payload.data;
  const images = await Promise.all(
    spec.images.map(async (image) => ({ ...image, url: await dataUrl(image.url) })),
  );
  const shots = await shoot(plan({ ...spec, images }));
  return { files: await deliver(spec, shots, options ?? {}) };
}

/**
 * The command line of a render script: `--fixture --out <dir>` renders the fixture property into a folder, with no
 * network and no upload, and prints one line per file.
 * @param {"cover" | "carousel" | "story"} kind
 * @param {(job: unknown, options: RenderOptions) => Promise<{ files: RenderedFile[] }>} run
 * @returns {Promise<void>}
 */
export async function runCli(kind, run) {
  try {
    const { values } = parseArgs({
      options: { fixture: { type: "boolean" }, out: { type: "string" } },
    });
    if (values.fixture !== true || values.out === undefined) {
      throw new Error(`render-${kind}: run it as --fixture --out <dir>`);
    }
    const fixture = fixtureSchema.parse(
      JSON.parse(await readText("src/templates/social/fixtures/property.fixture.json")),
    );
    const spec = {
      kind,
      property: fixture.property,
      images: fixture.images.map(({ path, ...image }) => ({ ...image, url: path })),
      out: { key_prefix: `assets/${fixture.property.id}/${kind}/r1/` },
    };
    const { files } = await run({ payload: { data: { spec } } }, { out: values.out });
    for (const file of files) {
      console.log(
        `${basename(file.media_key).split(".")[0] ?? ""} ${String(file.w)}x${String(file.h)} ok`,
      );
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
