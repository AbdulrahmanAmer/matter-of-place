// PERF-08 under H33 (8): the size arithmetic, and what `prepareImage` sends for a large, a small and an undecodable
// file. The browser's real encode is B4's `forms.spec.ts` (thumbnail at most 80 KB, original at most 2560 px).
import { afterEach, describe, expect, it, vi } from "vitest";
import { fitWithin, MAX_UPLOAD_EDGE, prepareImage } from "../../src/lib/image-prep";

/** Every canvas the code draws on, with the JPEG quality it asked for. */
const drawn: { width: number; height: number; quality: number | undefined }[] = [];

class FakeCanvas {
  constructor(
    readonly width: number,
    readonly height: number,
  ) {}

  getContext() {
    return { drawImage: () => undefined };
  }

  convertToBlob(options: { type: string; quality?: number }) {
    drawn.push({ width: this.width, height: this.height, quality: options.quality });
    return Promise.resolve(new Blob([`${String(this.width)}x${String(this.height)}`], options));
  }
}

function decodesAs(width: number, height: number) {
  vi.stubGlobal("OffscreenCanvas", FakeCanvas);
  vi.stubGlobal("createImageBitmap", () =>
    Promise.resolve({ width, height, close: () => undefined }),
  );
}

const photo = () => new File([new Uint8Array(64)], "image.jpg", { type: "image/jpeg" });

afterEach(() => {
  drawn.length = 0;
  vi.unstubAllGlobals();
});

describe("fitWithin", () => {
  it("brings 6000x4000 to 480x320 and to 2560x1707", () => {
    expect(fitWithin(6000, 4000, 480)).toEqual({ width: 480, height: 320 });
    expect(fitWithin(6000, 4000, MAX_UPLOAD_EDGE)).toEqual({ width: 2560, height: 1707 });
  });

  it("keeps 2400x1600 unchanged under 2560", () => {
    expect(fitWithin(2400, 1600, 2560)).toEqual({ width: 2400, height: 1600 });
  });
});

describe("prepareImage", () => {
  it("re-encodes a 6000 px original to a 2560 px JPEG and makes a 480 px thumbnail", async () => {
    decodesAs(4000, 6000);
    const prepared = await prepareImage(photo());
    expect(prepared.type).toBe("image/jpeg");
    expect(await prepared.original.text()).toBe("1707x2560");
    expect(await prepared.thumb?.text()).toBe("320x480");
    expect(drawn).toEqual([
      { width: 320, height: 480, quality: 0.8 },
      { width: 1707, height: 2560, quality: 0.9 },
    ]);
  });

  it("sends a 2400 px original unchanged, with its thumbnail", async () => {
    decodesAs(2400, 1600);
    const file = photo();
    const prepared = await prepareImage(file);
    expect(prepared.original).toBe(file);
    expect(prepared.type).toBe("image/jpeg");
    expect(await prepared.thumb?.text()).toBe("480x320");
  });

  it("sends a file the browser cannot decode unchanged and without a thumbnail", async () => {
    vi.stubGlobal("createImageBitmap", () => Promise.reject(new DOMException("no decoder")));
    const file = new File([new Uint8Array(64)], "IMG_0001.HEIC", { type: "image/heic" });
    expect(await prepareImage(file)).toEqual({ original: file, type: "image/heic", thumb: null });
  });
});
