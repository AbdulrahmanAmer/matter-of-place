// A catalog of any size in the shape of `public_catalog_snapshot()`, for tests that measure a payload or a call count
// (PERF-06). Every property carries a full gallery of rendered photographs and a long story, so a list row that kept
// the gallery or the text would show in the bytes. Built on the single property row of `snapshot.ts`.
import type { Json } from "../../src/db";
import { fakeDb } from "./fake-db";
import { propertyJson, snapshotJson, stateJson } from "./snapshot";

const GALLERY_SIZE = 8;
const SIZED = {
  thumb: { w: 320, h: 213 },
  card: { w: 720, h: 480 },
  hero: { w: 1600, h: 1067 },
  og: { w: 1200, h: 630 },
  carousel: { w: 1080, h: 1350 },
};

function syntheticProperty(index: number): Json {
  const slug = `synthetic-${String(index + 1).padStart(3, "0")}`;
  const base = propertyJson(slug);
  if (typeof base !== "object" || base === null || Array.isArray(base)) {
    throw new Error("propertyJson returned a value that is not an object");
  }
  return {
    ...base,
    title: `Synthetic residence ${String(index + 1)}`,
    story: Array.from(
      { length: 6 },
      (_unused, paragraph) =>
        `Paragraph ${String(paragraph + 1)} of a long story about a house that is kept as it was built, room by room.`,
    ),
    media: Array.from({ length: GALLERY_SIZE }, (_unused, photo) => ({
      id: `${slug}-m${String(photo)}`,
      media_key: `o/${slug}/${String(photo)}-ab12cd34.webp`,
      variants: SIZED,
      alt: `Room ${String(photo + 1)} of ${slug}`,
      orientation: "landscape",
      sort_order: photo,
    })),
  };
}

/** `count` published properties with a full gallery each, at one catalog version. */
export function syntheticCatalogSnapshot(count: number, version = 7): Json {
  return snapshotJson(version, {
    properties: Array.from({ length: count }, (_unused, index) => syntheticProperty(index)),
  });
}

/** A client that serves `syntheticCatalogSnapshot(count)` and records every call. */
export function syntheticCatalogDb(count: number, version = 7) {
  return fakeDb({
    rpc: {
      public_state: () => stateJson(version),
      public_catalog_snapshot: () => syntheticCatalogSnapshot(count, version),
    },
  });
}
