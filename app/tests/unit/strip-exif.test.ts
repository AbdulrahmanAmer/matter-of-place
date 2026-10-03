// GP-04, GQ-07, PERF-08: the stored master and every variant carry no EXIF, the long edge is at most 2560 px, and
// only the four upload types are accepted.
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { heicToJpeg } from "../../scripts/lib/heic";
import { stripExif } from "../../scripts/lib/strip-exif";
import { makeVariants } from "../../scripts/variants";

const fixture = (name: string) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url));
const photo = fixture("photo.jpg");
const photoGps = fixture("photo-gps.jpg");
const GPS_IFD_TAG = 0x8825;

/** The EXIF block sharp reads from an image, or undefined when it holds none. */
async function exifOf(body: Uint8Array): Promise<Buffer | undefined> {
  return (await sharp(body).metadata()).exif;
}

/** Whether IFD0 of an EXIF block ("Exif\0\0", then a TIFF header) has the pointer to a GPS IFD. */
function hasGps(exif: Buffer): boolean {
  const tiff = exif.subarray(6);
  const little = tiff.toString("latin1", 0, 2) === "II";
  const u16 = (at: number) => (little ? tiff.readUInt16LE(at) : tiff.readUInt16BE(at));
  const ifd0 = little ? tiff.readUInt32LE(4) : tiff.readUInt32BE(4);
  for (let entry = 0; entry < u16(ifd0); entry += 1) {
    if (u16(ifd0 + 2 + entry * 12) === GPS_IFD_TAG) return true;
  }
  return false;
}

async function expectClean(body: Uint8Array): Promise<void> {
  expect(await exifOf(body)).toBeUndefined();
  expect(Buffer.from(body).includes("Exif")).toBe(false);
}

describe("stripExif", () => {
  it("starts from a fixture that really has GPS", async () => {
    const exif = await exifOf(photoGps);
    expect(exif).toBeDefined();
    expect(exif !== undefined && hasGps(exif)).toBe(true);
    expect(await exifOf(photo)).toBeUndefined();
  });

  it("leaves no EXIF in the master", async () => {
    const master = await stripExif(photoGps, "image/jpeg");
    expect((await sharp(master).metadata()).format).toBe("webp");
    await expectClean(master);
  });

  it("leaves no EXIF in the master or in any of the five variants", async () => {
    const made = await makeVariants(photoGps, "image/jpeg");
    const bodies = [made.master, ...Object.values(made.files).map((file) => file.body)];
    expect(bodies).toHaveLength(6);
    for (const body of bodies) await expectClean(body);
  });

  it("fits a 6000x4000 JPEG inside 2560 px as WebP", async () => {
    const big = await sharp({
      create: { width: 6000, height: 4000, channels: 3, background: "#808080" },
    })
      .jpeg()
      .toBuffer();
    const { format, width, height } = await sharp(await stripExif(big, "image/jpeg")).metadata();
    expect({ format, width, height }).toEqual({ format: "webp", width: 2560, height: 1707 });
  });

  it("keeps the 2400x1600 fixture at its size", async () => {
    const { width, height } = await sharp(await stripExif(photo, "image/jpeg")).metadata();
    expect({ width, height }).toEqual({ width: 2400, height: 1600 });
  });

  it("applies the orientation before it drops the tag", async () => {
    const sideways = await sharp(photo)
      .resize(600, 400)
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const { width, height } = await sharp(await stripExif(sideways, "image/jpeg")).metadata();
    expect({ width, height }).toEqual({ width: 400, height: 600 });
  });

  it("refuses an image/gif", async () => {
    const gif = await sharp({
      create: { width: 8, height: 8, channels: 3, background: "#808080" },
    })
      .gif()
      .toBuffer();
    await expect(stripExif(gif, "image/gif")).rejects.toThrow("stripExif: unsupported image type");
  });
});

describe("a HEIC upload", () => {
  const heic = fixture("photo.heic");

  it("converts to JPEG, then strips to a WebP master", async () => {
    const jpeg = await heicToJpeg(heic);
    expect((await sharp(jpeg).metadata()).format).toBe("jpeg");
    const master = await stripExif(jpeg, "image/jpeg");
    expect(await sharp(master).metadata()).toMatchObject({
      format: "webp",
      width: 600,
      height: 400,
    });
    await expectClean(master);
  });

  it("makes all five variants through makeVariants", async () => {
    const made = await makeVariants(heic, "image/heic");
    expect(Object.keys(made.files)).toHaveLength(5);
    await expectClean(made.master);
  });
});
