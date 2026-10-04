// B9 close-out c6u: the one upload of a photograph's master and five sizes (`storeVariants`), shared by the seed, the
// `variants` CLI and `render_variants`, with `fetch` mocked: no Storage call leaves the `media` bucket of SUPABASE_URL.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  keysOfMaster,
  makeVariants,
  restoreVariants,
  storeVariants,
  variantKeys,
  type MediaVariants,
} from "../../../scripts/variants";

const BASE = "https://project.supabase.co";
const MEDIA = `${BASE}/storage/v1/object/media/`;
const photo = readFileSync(new URL("../../fixtures/photo.jpg", import.meta.url));

interface Upload {
  key: string;
  type: string | null;
  bytes: number;
}

function stubStorage(status = 200): Upload[] {
  const uploads: Upload[] = [];
  vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
    const headers = new Headers(init.headers);
    const body = init.body;
    uploads.push({
      key: url.slice(MEDIA.length),
      type: headers.get("content-type"),
      bytes: body instanceof Uint8Array ? body.length : 0,
    });
    return Promise.resolve(new Response("{}", { status }));
  });
  return uploads;
}

beforeEach(() => {
  vi.stubEnv("SUPABASE_URL", BASE);
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("storeVariants", () => {
  it("uploads the master and all five sizes to the media bucket under the keys it was given", async () => {
    const uploads = stubStorage();
    const made = await makeVariants(photo, "image/jpeg");
    const keys = variantKeys("oak-hill", 2, made.sha8);
    const stored = await storeVariants(made, keys);
    expect(uploads.map((upload) => upload.key).sort()).toEqual(
      [keys.master, keys.thumb, keys.card, keys.hero, keys.og, keys.carousel].sort(),
    );
    expect(uploads.find((upload) => upload.key === keys.master)).toMatchObject({
      type: "image/webp",
      bytes: made.master.length,
    });
    expect(uploads.find((upload) => upload.key === keys.og)?.type).toBe("image/jpeg");
    expect(stored.media_key).toBe(keys.master);
  });

  it("returns the width and height of each size and nothing else", async () => {
    stubStorage();
    const made = await makeVariants(photo, "image/jpeg");
    const stored = await storeVariants(made, variantKeys("oak-hill", 0, made.sha8));
    expect(Object.keys(stored.variants).sort()).toEqual([
      "card",
      "carousel",
      "hero",
      "og",
      "thumb",
    ]);
    expect(stored.variants.hero).toEqual({ w: made.files.hero.w, h: made.files.hero.h });
    expect(stored.variants.og).toEqual({ w: 1200, h: 630 });
  });

  it("counts a key Storage already holds as stored, and fails on any other refusal", async () => {
    const made = await makeVariants(photo, "image/jpeg");
    const keys = variantKeys("oak-hill", 0, made.sha8);
    vi.stubGlobal("fetch", () =>
      Promise.resolve(new Response(JSON.stringify({ statusCode: "409" }), { status: 400 })),
    );
    await expect(storeVariants(made, keys)).resolves.toMatchObject({ media_key: keys.master });
    vi.stubGlobal("fetch", () => Promise.resolve(new Response("{}", { status: 403 })));
    await expect(storeVariants(made, keys)).rejects.toThrow("answered 403");
  });
});

describe("keysOfMaster", () => {
  it("gives a stored master the keys its owner, index and hash fix", () => {
    expect(keysOfMaster("o/oak-hill/3-abcd1234.webp")).toEqual(
      variantKeys("oak-hill", 3, "abcd1234"),
    );
  });

  it("refuses a key that is not a master", () => {
    expect(() => keysOfMaster("v/oak-hill/3-abcd1234/hero.webp")).toThrow("is not a master key");
  });
});

describe("restoreVariants", () => {
  /** A master as the seed stores it, and the `media` bucket that holds it. */
  async function storedMaster(owner: string, n: number) {
    const made = await makeVariants(photo, "image/jpeg");
    const keys = variantKeys(owner, n, made.sha8);
    return { keys, master: made.master };
  }

  function stubBucket(masters: Map<string, Buffer>): string[] {
    const posted: string[] = [];
    vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
      const key = url.slice(MEDIA.length);
      if (init.method === "POST") {
        posted.push(key);
        return Promise.resolve(new Response("{}"));
      }
      const master = masters.get(key);
      return Promise.resolve(
        master === undefined
          ? new Response("{}", { status: 404 })
          : new Response(new Uint8Array(master)),
      );
    });
    return posted;
  }

  it("uploads the sizes under each master's own keys and writes variants to that row", async () => {
    const one = await storedMaster("oak-hill", 0);
    const posted = stubBucket(new Map([[one.keys.master, one.master]]));
    const written: [string, MediaVariants][] = [];
    const db = {
      stored: () => Promise.resolve([{ id: "row-1", media_key: one.keys.master }]),
      setVariants: (id: string, variants: MediaVariants) => {
        written.push([id, variants]);
        return Promise.resolve();
      },
    };
    expect(await restoreVariants(db, undefined)).toEqual({ stored: 1, failed: [] });
    expect(posted.sort()).toEqual(
      [
        one.keys.master,
        one.keys.thumb,
        one.keys.card,
        one.keys.hero,
        one.keys.og,
        one.keys.carousel,
      ].sort(),
    );
    expect(written.map(([id]) => id)).toEqual(["row-1"]);
    expect(Object.keys(written[0]?.[1] ?? {}).sort()).toEqual([
      "card",
      "carousel",
      "hero",
      "og",
      "thumb",
    ]);
  });

  it("names a row whose master cannot be read, leaves its variants alone and goes on", async () => {
    const one = await storedMaster("oak-hill", 1);
    stubBucket(new Map([[one.keys.master, one.master]]));
    const written: string[] = [];
    const db = {
      stored: () =>
        Promise.resolve([
          { id: "missing", media_key: "o/oak-hill/0-00000000.webp" },
          { id: "present", media_key: one.keys.master },
        ]),
      setVariants: (id: string) => {
        written.push(id);
        return Promise.resolve();
      },
    };
    const outcome = await restoreVariants(db, "property-1");
    expect(outcome.stored).toBe(1);
    expect(outcome.failed.map((failure) => failure.id)).toEqual(["missing"]);
    expect(outcome.failed[0]?.reason).toContain("answered 404");
    expect(written).toEqual(["present"]);
  });
});
