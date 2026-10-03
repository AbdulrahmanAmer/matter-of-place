// B9 step 6: `render_variants` with `fetch` mocked: the stripped master and the five sizes, no EXIF, no Storage call
// outside the `media` bucket of SUPABASE_URL.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { run } from "../../../scripts/render-variants.mjs";

const BASE = "https://project.supabase.co";
const MEDIA = `${BASE}/storage/v1/object/media/`;
const STAGED = "https://signed.example/staging/photo?token=t";
const gps = readFileSync(new URL("../../fixtures/photo-gps.jpg", import.meta.url));

function photo(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 120, g: 110, b: 100 } },
  })
    .jpeg()
    .toBuffer();
}

function jobOf(mediaId = "m1") {
  const item = {
    media_id: mediaId,
    staged_url: STAGED,
    mime: "image/jpeg",
    owner: "oak-hill",
    n: 0,
  };
  return { payload: { data: { media: [item] } } };
}

/** Fakes the signed staged URL and the `media` bucket: the stored bytes by key, and every address called. */
function stubStorage(original: Uint8Array, stagedStatus = 200) {
  const stored = new Map<string, Buffer>();
  const urls: string[] = [];
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    urls.push(url);
    if (url === STAGED) {
      return Promise.resolve(
        stagedStatus === 200
          ? new Response(new Uint8Array(original))
          : new Response("denied", { status: stagedStatus }),
      );
    }
    if (!(init?.body instanceof Uint8Array)) throw new Error("an upload without bytes");
    stored.set(url.slice(MEDIA.length), Buffer.from(init.body));
    return Promise.resolve(new Response("{}"));
  });
  return { stored, urls };
}

beforeEach(() => {
  vi.stubEnv("SUPABASE_URL", BASE);
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

// Each case decodes and encodes a 2400x1600 photograph six times; the 5 s default fails on a loaded laptop (G-031).
describe("render_variants", { timeout: 60_000 }, () => {
  it("GPS fixture's stripped copy has no EXIF", async () => {
    const { stored } = stubStorage(gps);
    expect((await sharp(gps).metadata()).exif).toBeDefined();
    const { media } = await run(jobOf());
    const master = stored.get(media["m1"]?.media_key ?? "");
    expect(master).toBeDefined();
    expect((await sharp(master).metadata()).exif).toBeUndefined();
  });

  it("every variant carries no EXIF", async () => {
    const { stored } = stubStorage(gps);
    await run(jobOf());
    expect(stored.size).toBe(6);
    for (const body of stored.values()) {
      expect((await sharp(body).metadata()).exif).toBeUndefined();
    }
  });

  it("a 403 from staged_url throws a retryable error naming the media id", async () => {
    const { urls } = stubStorage(gps, 403);
    const failure = await run(jobOf("m7")).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(Error);
    expect(failure).toHaveProperty("message", expect.stringContaining("m7"));
    expect(failure).toHaveProperty("message", expect.stringContaining("403"));
    expect(urls).toEqual([STAGED]);
  });

  it("a 6000x4000 fixture's stripped copy comes back 2560x1707", async () => {
    const { stored } = stubStorage(await photo(6000, 4000));
    const { media } = await run(jobOf());
    const master = await sharp(stored.get(media["m1"]?.media_key ?? "")).metadata();
    expect([master.width, master.height]).toEqual([2560, 1707]);
  });

  it("sends every upload to the media bucket of SUPABASE_URL", async () => {
    const { urls } = stubStorage(gps);
    await run(jobOf());
    const uploads = urls.filter((url) => url !== STAGED);
    expect(uploads).toHaveLength(6);
    expect(uploads.every((url) => url.startsWith(MEDIA))).toBe(true);
  });

  it("uploads the stripped copy and all five sizes under B2's key scheme", async () => {
    const { stored } = stubStorage(gps);
    const { media } = await run(jobOf());
    const master = stored.get(media["m1"]?.media_key ?? "");
    const sha8 = createHash("sha256")
      .update(master ?? "")
      .digest("hex")
      .slice(0, 8);
    expect([...stored.keys()].sort()).toEqual([
      `o/oak-hill/0-${sha8}.webp`,
      `v/oak-hill/0-${sha8}/card.webp`,
      `v/oak-hill/0-${sha8}/carousel.jpg`,
      `v/oak-hill/0-${sha8}/hero.webp`,
      `v/oak-hill/0-${sha8}/og.jpg`,
      `v/oak-hill/0-${sha8}/thumb.webp`,
    ]);
  });

  it("returns media_key and the five sizes per media id, and no orientation", async () => {
    stubStorage(gps);
    const { media } = await run(jobOf());
    expect(Object.keys(media)).toEqual(["m1"]);
    const entry = media["m1"];
    expect(Object.keys(entry ?? {}).sort()).toEqual(["media_key", "variants"]);
    expect(entry?.media_key).toMatch(/^o\/oak-hill\/0-[0-9a-f]{8}\.webp$/);
    expect(Object.keys(entry?.variants ?? {}).sort()).toEqual([
      "card",
      "carousel",
      "hero",
      "og",
      "thumb",
    ]);
    expect(entry?.variants["og"]).toEqual({ w: 1200, h: 630 });
  });

  it("gives hero a larger width for landscape and a larger height for portrait", async () => {
    stubStorage(await photo(1600, 1200));
    const landscape = (await run(jobOf())).media["m1"]?.variants["hero"];
    stubStorage(await photo(1200, 1600));
    const portrait = (await run(jobOf())).media["m1"]?.variants["hero"];
    expect(landscape && landscape.w > landscape.h).toBe(true);
    expect(portrait && portrait.h > portrait.w).toBe(true);
  });

  it("returns an item with a region media id under that same key", async () => {
    stubStorage(gps);
    const { media } = await run(jobOf("region:los-altos"));
    expect(Object.keys(media)).toEqual(["region:los-altos"]);
  });

  it("gives the same keys when the same photograph is rendered again", async () => {
    stubStorage(gps);
    const first = await run(jobOf());
    const second = await run(jobOf());
    expect(second).toEqual(first);
  });
});
