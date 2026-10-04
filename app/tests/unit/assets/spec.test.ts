// B9 step 8: the render spec built from rows (Contract). The same rows give the same spec and the same hash, every
// address is absolute and derived from the master key the way scripts/variants.ts keys it (P-335), and a row that
// bypassed the publish gate stops the render instead of drawing an empty slot (G62).
import { afterEach, describe, expect, it, vi } from "vitest";
import { variantKeys } from "../../../scripts/variants";
import {
  buildRenderSpec,
  loadMedia,
  specHash,
  variantsReady,
  type SpecKind,
} from "../../../src/server/assets/spec";
import { NonRetryableError } from "../../../src/server/jobs/types";
import { fakeDb } from "../../fixtures/fake-db";
import { MEDIA_BASE, PROPERTY_ID, mediaRow, propertyRow } from "../../fixtures/asset-rows";

afterEach(() => {
  vi.unstubAllEnvs();
});

const base = (): void => {
  vi.stubEnv("MEDIA_PUBLIC_BASE", MEDIA_BASE);
};

describe("buildRenderSpec", () => {
  it("builds the same spec and the same hash from the same rows", async () => {
    base();
    const media = [mediaRow(0), mediaRow(1), mediaRow(2)];
    const first = buildRenderSpec(propertyRow(), media, "cover", 1);
    const second = buildRenderSpec(propertyRow(), media, "cover", 1);
    expect(second).toEqual(first);
    expect(await specHash(second)).toBe(await specHash(first));
    expect(await specHash(first)).toMatch(/^[0-9a-f]{64}$/);
    const changed = buildRenderSpec(propertyRow({ price: 9_100_000 }), media, "cover", 1);
    expect(await specHash(changed)).not.toBe(await specHash(first));
  });

  it("carries the facts, the place paragraph and the key prefix of the revision", () => {
    base();
    const spec = buildRenderSpec(propertyRow(), [mediaRow(0)], "carousel", 3);
    expect(spec.property).toEqual({
      id: PROPERTY_ID,
      slug: "oak-hill",
      title: "A residence",
      city: "Los Altos Hills",
      state: "California",
      market: "california",
      price: 8950000,
      currency: "USD",
      beds: 5,
      baths: 4.5,
      interiorSqFt: 4320,
      yearBuilt: 2021,
      type: "Estate",
      place: "A quiet street under old oaks. The garden runs to the creek.",
    });
    expect(spec.out.key_prefix).toBe(`assets/${PROPERTY_ID}/carousel/r3/`);
    expect(
      buildRenderSpec(propertyRow({ place: null }), [mediaRow(0)], "cover", 1).property.place,
    ).toBe("");
  });

  it.each([
    { kind: "cover", size: "og", w: 1200, h: 630 },
    { kind: "carousel", size: "carousel", w: 1080, h: 1350 },
    { kind: "story", size: "carousel", w: 1080, h: 1350 },
  ] as const)("a $kind uses the $size size at an absolute address", ({ kind, size, w, h }) => {
    base();
    const spec = buildRenderSpec(propertyRow(), [mediaRow(2)], kind, 1);
    const key = variantKeys("oak-hill", 2, "aaaaaaaa")[size];
    expect(spec.images).toEqual([
      { url: `${MEDIA_BASE}/${key}`, alt: "Photograph 2", orientation: "landscape", w, h },
    ]);
  });

  it("skips a photograph that is not stored or lacks the size", () => {
    base();
    const media = [
      mediaRow(0),
      mediaRow(1, { media_key: null, variants: {} }),
      mediaRow(2, { variants: { thumb: { w: 320, h: 213 } } }),
    ];
    expect(buildRenderSpec(propertyRow(), media, "cover", 1).images).toHaveLength(1);
  });

  it.each(["price", "beds", "baths", "interior_sq_ft", "year_built"] as const)(
    "a row with %s null throws NonRetryableError publish_incomplete",
    (column) => {
      base();
      expect(() =>
        buildRenderSpec(propertyRow({ [column]: null }), [mediaRow(0)], "cover", 1),
      ).toThrow(new NonRetryableError("publish_incomplete"));
    },
  );

  it("refuses a master key that does not follow the key scheme", () => {
    base();
    expect(() =>
      buildRenderSpec(propertyRow(), [mediaRow(0, { media_key: "test/hero.webp" })], "cover", 1),
    ).toThrow(new NonRetryableError("media_key_unexpected"));
  });

  it.each(["cover", "carousel", "story"] as const satisfies readonly SpecKind[])(
    "the %s spec of 40 photographs stays far below the dispatch limit",
    (kind) => {
      base();
      const media = Array.from({ length: 40 }, (_, n) => mediaRow(n));
      const text = JSON.stringify(buildRenderSpec(propertyRow(), media, kind, 1));
      expect(text.length).toBeLessThan(20_000);
    },
  );
});

describe("loadMedia and variantsReady", () => {
  const db = (rows: ReturnType<typeof mediaRow>[]) => fakeDb({ tables: { property_media: rows } });

  it("loadMedia answers the gallery in order, hero first", async () => {
    const rows = await loadMedia(db([mediaRow(2), mediaRow(0), mediaRow(1)]), PROPERTY_ID);
    expect(rows.map((row) => row.sort_order)).toEqual([0, 1, 2]);
  });

  it("is ready when every photograph has the size", async () => {
    expect(await variantsReady(db([mediaRow(0), mediaRow(1)]), PROPERTY_ID, "og")).toBe(true);
  });

  it("is not ready while one photograph lacks the size", async () => {
    const rows = [mediaRow(0), mediaRow(1, { variants: { hero: { w: 1600, h: 1067 } } })];
    expect(await variantsReady(db(rows), PROPERTY_ID, "og")).toBe(false);
  });

  it("is not ready for a staged photograph", async () => {
    expect(
      await variantsReady(
        db([mediaRow(0), mediaRow(1, { variants: {} })]),
        PROPERTY_ID,
        "carousel",
      ),
    ).toBe(false);
  });

  it("is never ready for a property with no photograph", async () => {
    expect(await variantsReady(db([]), PROPERTY_ID, "og")).toBe(false);
  });
});
