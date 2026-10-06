// B12 step 3: the pure reel spec built from a property row and its photographs.
import { describe, expect, it } from "vitest";
import { specHash } from "../../../src/server/assets/spec.ts";
import {
  bedFor,
  buildReelSpec,
  type ReelBed,
  type ReelMediaRow,
  type ReelPropertyRow,
} from "../../../src/server/assets/reel-spec.ts";

const property: ReelPropertyRow = {
  id: "3f9a1c52-7b1e-4c3a-9d0e-5a6b7c8d9e0f",
  title: "A residence shaped around the landscape.",
  city: "Los Altos Hills",
  state: "California",
  market_slug: "california",
  price: 8950000,
  currency: "USD",
  beds: 5,
  baths: 4.5,
  interior_sq_ft: 4320,
  type: "Estate",
};

/** Photograph `n` of a gallery, alternating landscape and portrait; `key(n)` is its stripped copy in `media`. */
const key = (n: number) => `o/oak-hill/${String(n)}-0000000${String(n)}.webp`;
function gallery(count: number): ReelMediaRow[] {
  return Array.from({ length: count }, (_, n) => ({
    media_key: key(n),
    alt: `photograph ${String(n)}`,
    orientation: n % 2 === 0 ? "landscape" : "portrait",
    sort_order: n,
  }));
}
const keysOf = (rows: ReelMediaRow[], spec = buildReelSpec(property, rows)) =>
  spec.shots.map((shot) => shot.key);

describe("bedFor", () => {
  // The table of the plan, written out here so a change to the source table goes red.
  const EXPECTED: Record<string, [ReelBed, ReelBed, ReelBed]> = {
    // california, florida, new-york
    Waterfront: ["water", "water", "water"],
    Apartment: ["room", "room", "city"],
    Penthouse: ["room", "room", "city"],
    Estate: ["wind", "wind", "room"],
    Residence: ["wind", "wind", "room"],
    Townhouse: ["wind", "wind", "room"],
    Farmhouse: ["wind", "wind", "room"],
  };

  it("gives every type in every market the planned sound", () => {
    const types = [
      "Waterfront",
      "Apartment",
      "Penthouse",
      "Estate",
      "Residence",
      "Townhouse",
      "Farmhouse",
    ] as const;
    const got = types.map((type) => [
      bedFor(type, "california"),
      bedFor(type, "florida"),
      bedFor(type, "new-york"),
    ]);
    expect(got).toEqual(types.map((type) => EXPECTED[type]));
  });
});

describe("buildReelSpec", () => {
  it("takes the seed from the first 8 hex digits of the property id", () => {
    expect(buildReelSpec(property, gallery(10)).sound).toEqual({
      bed: "wind",
      seed: 0x3f9a1c52,
    });
  });

  it("uses each row's media_key as the shot key, for landscape and portrait rows alike", () => {
    const rows = gallery(10);
    const spec = buildReelSpec(property, rows);
    expect(spec.shots.map((shot) => shot.key)).toEqual(rows.map((row) => row.media_key));
    expect(spec.shots.map((shot) => shot.orientation)).toEqual(rows.map((row) => row.orientation));
    expect(new Set(spec.shots.map((shot) => shot.orientation))).toEqual(
      new Set(["landscape", "portrait"]),
    );
  });

  it("carries four camera shots and six tiles, and no URL", () => {
    const spec = buildReelSpec(property, gallery(12));
    expect(spec.shots).toHaveLength(10);
    expect(keysOf(gallery(12), spec)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(key));
    expect(JSON.stringify(spec)).not.toMatch(/https?:|src/);
  });

  it.each([
    [4, [0, 1, 2, 3, 0, 1, 2, 3, 0, 1]],
    [5, [0, 1, 2, 3, 4, 0, 1, 2, 3, 0]],
    [7, [0, 1, 2, 3, 4, 5, 6, 0, 1, 2]],
    [9, [0, 1, 2, 3, 4, 5, 6, 7, 8, 0]],
  ])("reuses the shots in order for %i photographs", (count, order) => {
    expect(keysOf(gallery(count))).toEqual(order.map(key));
  });

  it("orders the photographs by sort_order", () => {
    const shuffled = [...gallery(6)].reverse();
    expect(keysOf(shuffled).slice(0, 6)).toEqual([0, 1, 2, 3, 4, 5].map(key));
  });

  it("fills the copy block from the property", () => {
    expect(buildReelSpec(property, gallery(4)).copy).toMatchObject({
      location: "LOS ALTOS HILLS, CALIFORNIA",
      facts: "5 BED · 4.5 BATH · 4,320 SF",
      price: "$8,950,000",
    });
  });

  it("refuses fewer than four photographs", () => {
    expect(() => buildReelSpec(property, gallery(3))).toThrow("too_few_photos");
  });

  it("refuses a photograph with no stripped copy yet", () => {
    const rows = gallery(5);
    rows[2] = { media_key: null, alt: null, orientation: null, sort_order: 2 };
    expect(() => buildReelSpec(property, rows)).toThrow("media_key_missing");
  });

  it("refuses a row that bypassed the publish gate", () => {
    expect(() => buildReelSpec({ ...property, price: null }, gallery(4))).toThrow(
      "publish_incomplete",
    );
  });

  it("refuses a market outside California, New York and Florida", () => {
    expect(() => buildReelSpec({ ...property, market_slug: "texas" }, gallery(4))).toThrow(
      "market_unknown",
    );
  });

  it("gives the same spec hash for the same rows and another for a changed bed", async () => {
    const spec = buildReelSpec(property, gallery(10));
    const again = buildReelSpec(property, gallery(10));
    const otherBed = { ...spec, sound: { ...spec.sound, bed: "water" } } as const;
    expect(await specHash(spec)).toBe(await specHash(again));
    expect(await specHash(otherBed)).not.toBe(await specHash(spec));
  });
});
