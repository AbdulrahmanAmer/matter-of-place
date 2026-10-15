import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  describePicture,
  hashDistance,
  keepPictures,
  onePerPicture,
  pullImages,
  sizeFamily,
  type Picture,
} from "../../scripts/workforce/pull-images.ts";

// W7 item 9 (operator, 2026-10-16): "keep one file per picture". The Fairfield pull (request 4a3c2563) held 15 files of
// 5 pictures, each in Zillow's sizes 1536x1152, 960x720, 768x576 (webp and jpg) and 576x432.

const ZILLOW = "https://photos.zillowstatic.com/fp";
const HOUSE = "5d1a9c0e7f2b4a3c8e6d1f0a9b8c7d6e";
const GARDEN = "a0b1c2d3e4f5061728394a5b6c7d8e9f";

/** A picture drawn once at 1536x1152: a gradient one way or the other, with a shape, so the two never look alike. */
const drawn = (flip: boolean) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="1152"><defs><linearGradient id="g" x1="${flip ? "1" : "0"}" x2="${flip ? "0" : "1"}" y1="0" y2="0"><stop offset="0" stop-color="#11110f"/><stop offset="1" stop-color="#eeeae1"/></linearGradient></defs><rect width="1536" height="1152" fill="url(#g)"/><circle cx="${flip ? "400" : "1100"}" cy="500" r="220" fill="#575751"/></svg>`,
  );

type Size = { width: number; height: number; format: "jpeg" | "webp"; name: string };
const SIZES: Size[] = [
  { width: 1536, height: 1152, format: "jpeg", name: "cc_ft_1536.jpg" },
  { width: 960, height: 720, format: "jpeg", name: "cc_ft_960.jpg" },
  { width: 768, height: 576, format: "webp", name: "cc_ft_768.webp" },
  { width: 768, height: 576, format: "jpeg", name: "cc_ft_768.jpg" },
  { width: 576, height: 432, format: "jpeg", name: "cc_ft_576.jpg" },
];

async function render(flip: boolean, size: Size): Promise<Uint8Array> {
  const { data, info } = await sharp(drawn(flip))
    .resize(size.width, size.height)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  // grain, so each size weighs what a real photograph does (the pull skips a file under 30 kB as an icon)
  let seed = size.width * 7 + (flip ? 1 : 0);
  for (let index = 0; index < data.length; index += 1) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    data[index] = Math.max(0, Math.min(255, (data[index] ?? 0) + (seed % 41) - 20));
  }
  const image = sharp(data, { raw: info });
  return new Uint8Array(
    await (size.format === "webp" ? image.webp() : image.jpeg({ quality: 82 })).toBuffer(),
  );
}

type Read = Picture & {
  data: Uint8Array;
  mime: "image/jpeg" | "image/webp";
  sha256: string;
  page_url: string;
};

async function read(flip: boolean, size: Size, url: string): Promise<Read> {
  const data = await render(flip, size);
  const picture = await describePicture(data, url);
  if (picture === null) throw new Error("the fixture could not be read");
  return {
    ...picture,
    data,
    mime: size.format === "webp" ? "image/webp" : "image/jpeg",
    sha256: `${String(flip)}-${size.name}`,
    page_url: "https://www.zillow.com/homedetails/fairfield",
  };
}

let house: Read[] = [];
let garden: Read[] = [];

beforeAll(async () => {
  house = await Promise.all(
    SIZES.map((size) => read(false, size, `${ZILLOW}/${HOUSE}-${size.name}`)),
  );
  garden = await Promise.all(
    SIZES.slice(2).map((size) => read(true, size, `${ZILLOW}/${GARDEN}-${size.name}`)),
  );
});

describe("one file per picture (W7 item 9)", () => {
  it("gives every Zillow size of one picture one family, and two pictures two", () => {
    const families = new Set(house.map((image) => sizeFamily(image.url)));
    expect([...families]).toEqual([`photos.zillowstatic.com/fp/${HOUSE}`]);
    expect(sizeFamily(`${ZILLOW}/${HOUSE}-uncropped_scaled_within_1536_1152.webp`)).toBe(
      `photos.zillowstatic.com/fp/${HOUSE}`,
    );
    expect(sizeFamily(`${ZILLOW}/${GARDEN}-cc_ft_960.jpg`)).not.toBe(
      sizeFamily(`${ZILLOW}/${HOUSE}-cc_ft_960.jpg`),
    );
  });

  it("hashes one picture alike at every size and two pictures far apart", () => {
    const [largest, ...smaller] = house;
    for (const image of smaller)
      expect(hashDistance(largest?.dhash ?? "", image.dhash)).toBeLessThan(5);
    expect(hashDistance(largest?.dhash ?? "", garden[0]?.dhash ?? "")).toBeGreaterThan(32);
  });

  it("keeps one of three sizes of a picture and two of two pictures, the largest each", () => {
    const folder = mkdtempSync(join(tmpdir(), "w7-9-pull-"));
    const pulled = keepPictures([...house.slice(2), ...garden, ...house.slice(0, 2)], folder);
    expect(pulled.map((image) => image.file.slice(0, 3))).toEqual(["01.", "02."]);
    expect(readdirSync(folder).sort()).toEqual(pulled.map((image) => image.file));
    expect(pulled.map((image) => [image.width, image.height])).toEqual([
      [1536, 1152],
      [768, 576],
    ]);
    expect(pulled[0]?.source_url).toBe(`${ZILLOW}/${HOUSE}-cc_ft_1536.jpg`);
    expect(pulled[0]?.same_picture).toHaveLength(4);
    expect(pulled[1]?.same_picture).toHaveLength(2);
  });

  it("tells sizes of an uploaded picture by shape alone, with no address to go by", () => {
    const uploads = [...house.slice(0, 2), garden[0]].flatMap((image, index) =>
      image === undefined ? [] : [{ ...image, url: `upload:${String(index)}` }],
    );
    const groups = onePerPicture(uploads);
    expect(groups.map((group) => group.kept.width)).toEqual([1536, 768]);
    expect(groups[0]?.also.map((image) => image.width)).toEqual([960]);
  });

  it("keeps two different pictures apart even when their addresses look like sizes of one", () => {
    const same = [house[0], garden[0]].flatMap((image, index) =>
      image === undefined
        ? []
        : [
            {
              ...image,
              url: `https://cdn.example.com/photos/IMG_${String(1234 + index)}_1024.jpg`,
            },
          ],
    );
    expect(onePerPicture(same)).toHaveLength(2);
  });

  it("lets a size family absorb a re-cropped size, never a stranger", () => {
    const at = (url: string, dhash: string, width: number): Picture => ({
      url,
      width,
      height: (width * 3) / 4,
      bytes: width,
      dhash,
    });
    const full = at(`${ZILLOW}/${HOUSE}-cc_ft_1536.jpg`, "ffffffffffffffff", 1536);
    // twelve bits apart: more than two sizes of one picture usually are, far less than two pictures
    const cropped = at(`${ZILLOW}/${HOUSE}-cc_ft_960.jpg`, "fff000ffffffffff", 960);
    const stranger = at("upload:7", "fff000ffffffffff", 960);
    expect(onePerPicture([full, cropped])).toHaveLength(1);
    expect(onePerPicture([full, stranger])).toHaveLength(2);
  });
});

describe("the pull keeps one file per picture in the studio folder (W7 item 9)", () => {
  const PAGE = "https://www.zillow.com/homedetails/fairfield";
  const ID = "4a3c2563-1111-4111-8111-111111111111";

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const serve = () => {
    const images = new Map([...house, ...garden].map((image) => [image.url, image.data]));
    const html = [...images.keys()].map((url) => `<img src="${url}">`).join("\n");
    vi.stubGlobal("fetch", (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const bytes = images.get(url);
      if (url === PAGE) return Promise.resolve(new Response(html, { status: 200 }));
      return Promise.resolve(
        bytes === undefined ? new Response("", { status: 404 }) : new Response(Buffer.from(bytes)),
      );
    });
  };

  it("pulls eight files of two pictures as two files, the other sizes named", async () => {
    serve();
    const studio = mkdtempSync(join(tmpdir(), "w7-9-studio-"));
    const { pulled, folder } = await pullImages({ id: ID, links: [PAGE] }, { studio });
    expect(pulled).toHaveLength(2);
    expect(readdirSync(folder).sort()).toEqual([
      ...pulled.map((image) => image.file),
      "sources.json",
    ]);
    const sources: unknown = JSON.parse(readFileSync(join(folder, "sources.json"), "utf8"));
    expect(sources).toMatchObject({
      request: ID,
      images: [{ source_url: `${ZILLOW}/${HOUSE}-cc_ft_1536.jpg`, width: 1536 }, { width: 768 }],
    });
    expect(pulled[0]?.same_picture).toHaveLength(4);
  });

  it("stops reading once the bytes it holds reach the budget", async () => {
    serve();
    const studio = mkdtempSync(join(tmpdir(), "w7-9-studio-"));
    const { pulled } = await pullImages({ id: ID, links: [PAGE] }, { studio, heldLimit: 1 });
    expect(pulled.map((image) => image.source_url)).toEqual([`${ZILLOW}/${HOUSE}-cc_ft_1536.jpg`]);
  });
});
