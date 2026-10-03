// The five sizes of a photograph (B2 step 13): formats, dimensions, key shapes and the CLI's arguments.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import {
  makeVariants,
  parseVariantsArgs,
  variantKeys,
  type MadeVariants,
  type MediaVariants,
} from "../../scripts/variants";

const photo = readFileSync(new URL("../fixtures/photo.jpg", import.meta.url));
const NAMES = ["card", "carousel", "hero", "og", "thumb"];

async function shapeOf(
  body: Buffer,
): Promise<{ format: string | undefined; w: number; h: number }> {
  const { format, width, height } = await sharp(body).metadata();
  return { format, w: width, h: height };
}

describe("makeVariants", () => {
  let made: MadeVariants;
  beforeAll(async () => {
    made = await makeVariants(photo, "image/jpeg");
  });

  it("renders thumb 320, card 720 and hero 1600 as WebP only", async () => {
    for (const [name, w] of [
      ["thumb", 320],
      ["card", 720],
      ["hero", 1600],
    ] as const) {
      const file = made.files[name];
      expect(await shapeOf(file.body)).toMatchObject({ format: "webp", w });
      expect(file.type).toBe("image/webp");
      expect(file.w).toBe(w);
    }
  });

  it("renders og exactly 1200x630 and carousel exactly 1080x1350 as JPEG", async () => {
    expect(await shapeOf(made.files.og.body)).toEqual({ format: "jpeg", w: 1200, h: 630 });
    expect(await shapeOf(made.files.carousel.body)).toEqual({ format: "jpeg", w: 1080, h: 1350 });
    expect([made.files.og.type, made.files.carousel.type]).toEqual(["image/jpeg", "image/jpeg"]);
  });

  it("writes no AVIF anywhere", async () => {
    const formats = await Promise.all(
      [made.master, ...Object.values(made.files).map((file) => file.body)].map(
        async (body) => (await shapeOf(body)).format,
      ),
    );
    expect(formats.filter((format) => format !== "webp" && format !== "jpeg")).toEqual([]);
    expect(
      Object.values(variantKeys("test", 0, made.sha8)).filter((key) => key.endsWith(".avif")),
    ).toEqual([]);
  });

  it("keeps the hero WebP under 400 KB", () => {
    expect(made.files.hero.body.length).toBeLessThan(400 * 1024);
  });

  it("stores a WebP master and takes its sha8 from the master's bytes", async () => {
    expect((await shapeOf(made.master)).format).toBe("webp");
    expect(made.sha8).toBe(createHash("sha256").update(made.master).digest("hex").slice(0, 8));
  });

  it("returns exactly the five keys of MediaVariants, each with the size it has", async () => {
    const files: Record<keyof MediaVariants, { w: number; h: number }> = made.files;
    expect(Object.keys(files).sort()).toEqual(NAMES);
    for (const file of Object.values(made.files)) {
      expect(await shapeOf(file.body)).toMatchObject({ w: file.w, h: file.h });
    }
  });

  it("refuses a type outside the four", async () => {
    await expect(makeVariants(photo, "image/gif")).rejects.toThrow("makeVariants: unsupported");
  });
});

describe("variantKeys", () => {
  it("gives the master o/<owner>/<n>-<sha8>.webp and the variants v/<owner>/<n>-<sha8>/<name>.<ext>", () => {
    expect(variantKeys("oak-hill-residence", 2, "abcd1234")).toEqual({
      master: "o/oak-hill-residence/2-abcd1234.webp",
      thumb: "v/oak-hill-residence/2-abcd1234/thumb.webp",
      card: "v/oak-hill-residence/2-abcd1234/card.webp",
      hero: "v/oak-hill-residence/2-abcd1234/hero.webp",
      og: "v/oak-hill-residence/2-abcd1234/og.jpg",
      carousel: "v/oak-hill-residence/2-abcd1234/carousel.jpg",
    });
  });
});

describe("parseVariantsArgs", () => {
  it("reads one mode, ignoring a leading --", () => {
    expect(parseVariantsArgs(["--", "--file", "a.jpg", "--owner", "test"])).toEqual({
      mode: "file",
      file: "a.jpg",
      owner: "test",
    });
    expect(parseVariantsArgs(["--property", "p1"])).toEqual({ mode: "property", property: "p1" });
    expect(parseVariantsArgs(["--all"])).toEqual({ mode: "all" });
  });

  it("refuses no mode, two modes, a file without an owner and an unknown option", () => {
    expect(() => parseVariantsArgs([])).toThrow("exactly one of");
    expect(() => parseVariantsArgs(["--all", "--property", "p1"])).toThrow("exactly one of");
    expect(() => parseVariantsArgs(["--file", "a.jpg"])).toThrow("--file needs --owner");
    expect(() => parseVariantsArgs(["--sizes", "3"])).toThrow();
  });
});
