// B9 step 6: width and height read from the header bytes of a PNG and of a JPEG (baseline and progressive).
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { imageSize } from "../../../scripts/lib/png-size.mjs";

const flat = {
  create: { width: 30, height: 20, channels: 3, background: { r: 128, g: 128, b: 128 } },
} as const;

describe("imageSize", () => {
  it("reads a PNG from its IHDR", async () => {
    expect(imageSize(await sharp(flat).png().toBuffer())).toEqual({ width: 30, height: 20 });
  });

  it("reads a baseline JPEG from its SOF0 marker", async () => {
    expect(imageSize(await sharp(flat).jpeg().toBuffer())).toEqual({ width: 30, height: 20 });
  });

  it("reads a progressive JPEG from its SOF2 marker", async () => {
    const body = await sharp(flat).jpeg({ progressive: true }).toBuffer();
    expect(body.includes(Buffer.from([0xff, 0xc2]))).toBe(true);
    expect(imageSize(body)).toEqual({ width: 30, height: 20 });
  });

  it("skips the EXIF segment of a camera JPEG", async () => {
    const photo = readFileSync(new URL("../../fixtures/photo-gps.jpg", import.meta.url));
    const { width, height } = await sharp(photo).metadata();
    expect(imageSize(photo)).toEqual({ width, height });
  });

  it("refuses bytes that are neither", () => {
    expect(() => imageSize(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]))).toThrow(
      "not a PNG or a JPEG",
    );
  });
});
