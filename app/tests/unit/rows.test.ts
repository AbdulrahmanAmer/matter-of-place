// The seed's pure parts (B2 step 12): the row mappers, the argument parser and runSeed driven by stubs, no database.
import { describe, expect, it, vi } from "vitest";
import { markets } from "../../src/data/markets";
import { properties } from "../../src/data/properties";
import { stories } from "../../src/data/stories";
import {
  marketToRows,
  propertyToRows,
  stableId,
  storyToRow,
  type KeyOf,
} from "../../scripts/lib/rows";
import { localApiUrl, parseSeedArgs } from "../../scripts/lib/seed-args";
import { runSeed, type SeedDb } from "../../scripts/seed";
import { variantKeys } from "../../scripts/variants";
import { schemaManifest } from "../db/schema-manifest";

const SHA8 = "abcd1234";
const keyOf: KeyOf = (_source, owner, n) => variantKeys(owner, n, SHA8).master;
const sha8 = () => Promise.resolve(SHA8);

interface Call {
  op: "upsert" | "update";
  table: string;
  rows?: readonly Record<string, unknown>[];
  options?: Parameters<SeedDb["upsert"]>[2];
  values?: Record<string, unknown>;
  where?: Record<string, string>;
}

function recordingDb(): { db: SeedDb; calls: Call[] } {
  const calls: Call[] = [];
  const db: SeedDb = {
    upsert(table, rows, options) {
      calls.push({ op: "upsert", table, rows, options });
      return Promise.resolve();
    },
    update(table, values, where) {
      calls.push({ op: "update", table, values, where });
      return Promise.resolve();
    },
  };
  return { db, calls };
}

function unknownColumns(table: string, row: object): string[] {
  const columns = schemaManifest[table] ?? {};
  return Object.keys(row).filter((key) => !(key in columns));
}

const refusing = () => Promise.reject(new Error("refusing: production database"));

describe("propertyToRows", () => {
  const tiburon = properties.find((property) => property.slug === "tiburon-waterline");

  it("yields snake_case keys that are all columns, for every bundled property", () => {
    const unknown = properties.flatMap((property) => {
      const rows = propertyToRows(property, keyOf);
      return [
        ...unknownColumns("properties", rows.property).map((key) => `properties.${key}`),
        ...rows.media.flatMap((row) => unknownColumns("property_media", row)),
        ...rows.features.flatMap((row) => unknownColumns("property_features", row)),
        ...rows.related.flatMap((row) => unknownColumns("property_related", row)),
      ];
    });
    expect(unknown).toEqual([]);
  });

  it("writes coordinates as point(longitude, latitude) and the price as a string with two decimals", () => {
    const first = properties[0];
    if (first === undefined) throw new Error("no bundled property");
    const [latitude, longitude] = first.coordinates ?? [0, 0];
    const { property } = propertyToRows(first, keyOf);
    expect(property.coordinates).toBe(`(${String(longitude)},${String(latitude)})`);
    expect(property.price).toBe(`${String(first.price)}.00`);
    expect(property.status).toBe("Illustrative");
  });

  it("puts the hero first, keys every photograph o/<owner>/<n>-<sha8>.webp and leaves variants empty", () => {
    const first = properties[0];
    if (first === undefined) throw new Error("no bundled property");
    const { media, property } = propertyToRows(first, keyOf);
    expect(media.map((row) => row.sort_order)).toEqual(media.map((_row, index) => index));
    expect(media.map((row) => row.media_key)).toEqual(
      media.map((_row, index) => `o/${first.slug}/${String(index)}-${SHA8}.webp`),
    );
    expect(media[0]?.alt).toBe(first.title);
    expect(media.map((row) => row.variants)).toEqual(media.map(() => ({})));
    expect(media.map((row) => row.staging_path ?? null)).toEqual(media.map(() => null));
    expect(property).not.toHaveProperty("hero_image");
    expect(property).not.toHaveProperty("editorial_state");
  });

  it("keys the video as a bucket key and its poster as one more photograph of the same owner", () => {
    expect(tiburon?.video).toBeDefined();
    if (tiburon === undefined) throw new Error("no tiburon-waterline");
    const rows = propertyToRows(tiburon, keyOf);
    expect(rows.property.video).toEqual({
      src: "tiburon-waterline.mp4",
      poster: `o/tiburon-waterline/${String(rows.media.length)}-${SHA8}.webp`,
      caption: tiburon.video?.caption,
      duration: tiburon.video?.duration,
    });
  });

  it("gives the same ids on every call, so a rerun upserts the same rows", () => {
    const first = properties[0];
    if (first === undefined) throw new Error("no bundled property");
    expect(propertyToRows(first, keyOf)).toEqual(propertyToRows(first, keyOf));
    expect(stableId("property", first.slug)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});

describe("marketToRows and storyToRow", () => {
  it("yield snake_case keys that are all columns", () => {
    const unknown = markets.flatMap((market, index) => {
      const rows = marketToRows(market, keyOf, index);
      return [
        ...unknownColumns("markets", rows.market),
        ...rows.regions.flatMap((row) => unknownColumns("regions", row)),
        ...rows.notes.flatMap((row) => unknownColumns("market_notes", row)),
        ...rows.guide.flatMap((row) => unknownColumns("market_guide_entries", row)),
      ];
    });
    const storyUnknown = stories.flatMap((story) =>
      unknownColumns("stories", storyToRow(story, keyOf)),
    );
    expect([...unknown, ...storyUnknown]).toEqual([]);
  });

  it("carries every region, note and guide entry of the bundled markets", () => {
    const rows = markets.map((market, index) => marketToRows(market, keyOf, index));
    expect(rows.flatMap((entry) => entry.regions)).toHaveLength(12);
    const guide = markets.reduce(
      (total, market) =>
        total +
        market.guide.neighborhoods.length +
        market.guide.needs.length +
        market.guide.service.length,
      0,
    );
    expect(rows.flatMap((entry) => entry.guide)).toHaveLength(guide);
    expect(rows.flatMap((entry) => entry.notes)).toHaveLength(
      markets.reduce((total, market) => total + market.notes.length, 0),
    );
  });
});

describe("parseSeedArgs", () => {
  const defaults = { target: "dev", mode: "full", images: "skip" };

  it.each([[[]], [["--target", "dev"]], [["--", "--target", "dev"]]])(
    "reads %j as the defaults",
    (argv) => {
      expect(parseSeedArgs(argv)).toEqual(defaults);
    },
  );

  it("accepts the local target, the reference mode and the upload mode", () => {
    expect(parseSeedArgs(["--target", "local"])).toEqual({ ...defaults, target: "local" });
    expect(parseSeedArgs(["--mode", "reference", "--images", "upload"])).toEqual({
      ...defaults,
      mode: "reference",
      images: "upload",
    });
  });

  it.each([
    [["--target", "prod"]],
    [["--target", "prod", "--mode", "reference"]],
    [["--confirm-production"]],
    [["--images", "r2"]],
    [["--target"]],
  ])(
    "refuses %j because there is no production target and the image modes are upload and skip",
    (argv) => {
      expect(() => parseSeedArgs(argv)).toThrow("seed: invalid arguments");
    },
  );

  it("refuses a local target whose API is not on 127.0.0.1", () => {
    expect(localApiUrl("http://127.0.0.1:54321")).toBe("http://127.0.0.1:54321");
    expect(() => localApiUrl("https://x.supabase.co")).toThrow(
      "seed: invalid arguments local target must be 127.0.0.1",
    );
    expect(() => localApiUrl(undefined)).toThrow("local target must be 127.0.0.1");
  });
});

describe("runSeed", () => {
  const full = { target: "dev", mode: "full", images: "skip" } as const;
  const reference = { target: "dev", mode: "reference", images: "skip" } as const;

  it("counts what the bundled data holds", async () => {
    const { db } = recordingDb();
    const counts = await runSeed(full, { db, sha8, guard: vi.fn(() => Promise.resolve()) });
    expect(counts).toEqual({ markets: 3, regions: 12, properties: 16, stories: 6 });
  });

  it("calls the guard before its first write in full mode and refuses on production", async () => {
    const { db, calls } = recordingDb();
    await expect(runSeed(full, { db, sha8, guard: refusing })).rejects.toThrow(
      "refusing: production database",
    );
    expect(calls).toEqual([]);
  });

  it("does not call the guard in reference mode and writes only reference rows, each only when missing", async () => {
    const { db, calls } = recordingDb();
    const guard = vi.fn(refusing);
    const counts = await runSeed(reference, { db, sha8, guard });
    expect(guard).not.toHaveBeenCalled();
    expect(counts).toEqual({ markets: 3, regions: 12, properties: 0, stories: 0 });
    expect(calls.map((call) => `${call.op} ${call.table}`)).toEqual([
      "upsert markets",
      "upsert regions",
      "upsert market_notes",
      "upsert market_guide_entries",
    ]);
    expect(calls.map((call) => call.options?.ignoreDuplicates)).toEqual([true, true, true, true]);
  });

  it("makes a property public only after its media, through review, and opens the markets last", async () => {
    const { db, calls } = recordingDb();
    await runSeed(full, { db, sha8, guard: vi.fn(() => Promise.resolve()) });
    const order = calls.map((call) => `${call.op} ${call.table}`);
    expect(order.indexOf("upsert property_media")).toBeGreaterThan(
      order.indexOf("upsert properties"),
    );
    const published = calls.filter((call) => call.values?.["editorial_state"] === "published");
    expect(published).toHaveLength(16);
    expect(published.every((call) => call.where?.["editorial_state"] === "review")).toBe(true);
    expect(published.map((call) => call.values?.["published_at"])).toEqual(
      properties.map((property) => `${property.publishedAt}T00:00:00Z`),
    );
    expect(
      calls.findIndex((call) => call.values?.["editorial_state"] === "review"),
    ).toBeGreaterThan(order.indexOf("upsert property_media"));
    expect(calls.filter((call) => call.values?.["coming_soon"] === false)).toHaveLength(3);
    expect(calls.at(-1)?.table).toBe("markets");
  });

  it("refuses the upload mode until the media store exists", async () => {
    const { db } = recordingDb();
    await expect(runSeed({ ...full, images: "upload" }, { db, sha8 })).rejects.toThrow(
      "--images upload",
    );
  });
});
