import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Json } from "../../src/db";
import { propertyCardSchema } from "../../src/domain/contracts";
import { pickCard } from "../../src/lib/property-card";
import { mapSnapshot, parseSnapshot, toPropertyCard } from "../../src/server/public/mappers";
import type { PublicState } from "../../src/server/public/state";
import {
  archiveHref,
  facetMap,
  getFacet,
  listFacets,
  MIN_ARCHIVE,
} from "../../src/server/seo/archive";
import { propertyJson, snapshotJson } from "../fixtures/snapshot";

const stateWith = (flags: Record<string, unknown>): PublicState => ({
  catalogVersion: 7,
  flags,
  comingSoonGlobal: false,
  comingSoonMarkets: {},
  site: {},
  illustrativeContent: false,
  ogStatic: {},
});
const on = stateWith({ archive_pages: true });
const off = stateWith({ archive_pages: false });

/** The catalog the Worker holds: mapped rows and their list cards, built through the real mapper. */
function catalogOf(rows: Record<string, Json>[]) {
  const mapped = mapSnapshot(
    parseSnapshot(
      snapshotJson(7, {
        properties: rows.map((fields, index) => {
          const base = propertyJson(`p${String(index)}`);
          if (typeof base !== "object" || base === null || Array.isArray(base))
            throw new Error("propertyJson is an object");
          return { ...base, ...fields };
        }),
      }),
    ),
    on,
  );
  return { ...mapped, cards: mapped.properties.map(toPropertyCard) };
}

const alike = (count: number, fields: Record<string, Json>) =>
  Array.from({ length: count }, () => fields);
// Each row has a city and a style of its own unless the case gives one, so only the facet under test reaches the threshold.
const lone = (index: number): Record<string, Json> => ({
  city: `City ${String(index)}`,
  style: `Style ${String(index)}`,
});
const withOwn = (rows: Record<string, Json>[]) =>
  rows.map((fields, index) => ({ ...lone(index), ...fields }));

describe("the archive threshold", () => {
  it("lists a facet of three published properties and not one of two", () => {
    const catalog = catalogOf(
      withOwn([
        ...alike(3, { architect: "Fixture Architect" }),
        ...alike(2, { style: "Fixture Style" }),
      ]),
    );
    expect(
      listFacets(catalog, on).map(({ kind, slug, count }) => `${kind}/${slug}:${String(count)}`),
    ).toEqual(["architect/fixture-architect:3"]);
  });

  it("agrees with the threshold of the view in its migration", () => {
    const migrations = new URL("../../supabase/migrations/", import.meta.url);
    const file = readdirSync(migrations).find((name) => name.endsWith("_archive_facets.sql"));
    expect(file).toBeDefined();
    const sql = readFileSync(new URL(file ?? "", migrations), "utf8");
    expect(MIN_ARCHIVE).toBe(3);
    expect(sql.match(/having count\(\*\) >= (\d+)/g)).toEqual([
      `having count(*) >= ${String(MIN_ARCHIVE)}`,
    ]);
  });

  it("lists nothing, finds nothing and links nothing while the flag is off", () => {
    const catalog = catalogOf(withOwn(alike(3, { architect: "Fixture Architect" })));
    expect({
      facets: listFacets(catalog, off),
      page: getFacet(catalog, off, "architect", "fixture-architect"),
      map: facetMap(catalog, off),
      href: archiveHref(catalog, off, "architect", "Fixture Architect"),
    }).toEqual({
      facets: [],
      page: null,
      map: { city: {}, architect: {}, style: {} },
      href: null,
    });
  });

  it("treats a flag that is missing like a flag that is off", () => {
    const catalog = catalogOf(withOwn(alike(3, { architect: "Fixture Architect" })));
    expect(listFacets(catalog, stateWith({}))).toEqual([]);
  });
});

describe("facets", () => {
  it("map each kind to its labels and slugs, a city by city and state", () => {
    const catalog = catalogOf([
      ...alike(3, {
        city: "Tiburon",
        state: "California",
        architect: "Frank Lloyd Wright",
        style: "Shingle Style",
      }),
      ...alike(3, { city: "Sag Harbor", state: "New York", architect: null, style: "Modern" }),
    ]);
    expect(facetMap(catalog, on)).toEqual({
      city: { "Tiburon, California": "tiburon-ca", "Sag Harbor, New York": "sag-harbor-ny" },
      architect: { "Frank Lloyd Wright": "frank-lloyd-wright" },
      style: { "Shingle Style": "shingle-style", Modern: "modern" },
    });
  });

  it("folds accents and apostrophes into the slug and keeps the label that sorts first", () => {
    const catalog = catalogOf(
      withOwn([
        { architect: "Zürich O'Brien" },
        { architect: "Zurich OBrien" },
        { architect: "Zürich O’Brien" },
      ]),
    );
    expect(getFacet(catalog, on, "architect", "zurich-obrien")?.label).toBe("Zurich OBrien");
  });

  it("links every spelling of a label to its facet", () => {
    const catalog = catalogOf(
      withOwn([
        { architect: "Richard Neutra" },
        { architect: "Richard Neutra" },
        { architect: "Richard Neutra " },
      ]),
    );
    expect(facetMap(catalog, on).architect).toEqual({
      "Richard Neutra": "richard-neutra",
      "Richard Neutra ": "richard-neutra",
    });
  });

  it("skips an architect that is blank", () => {
    const catalog = catalogOf(withOwn(alike(3, { architect: "  " })));
    expect(facetMap(catalog, on).architect).toEqual({});
  });

  it("find a page by kind and slug, and answer null for anything else", () => {
    const catalog = catalogOf(withOwn(alike(3, { architect: "Fixture Architect" })));
    expect([
      getFacet(catalog, on, "architect", "fixture-architect")?.count,
      getFacet(catalog, on, "style", "fixture-architect"),
      getFacet(catalog, on, "architect", "nobody"),
    ]).toEqual([3, null, null]);
  });

  it("make the address of an archive page from a label, null when it has none", () => {
    const catalog = catalogOf(withOwn(alike(3, { architect: "Fixture Architect" })));
    expect([
      archiveHref(catalog, on, "architect", "Fixture Architect"),
      archiveHref(catalog, on, "architect", "Someone Else"),
    ]).toEqual(["/archive/architect/fixture-architect", null]);
  });
});

describe("getFacet items", () => {
  it("are list cards: the keys of a PropertyCard, never the gallery", () => {
    const catalog = catalogOf(withOwn(alike(3, { architect: "Fixture Architect" })));
    const facet = getFacet(catalog, on, "architect", "fixture-architect");
    expect(facet?.items.map(({ slug }) => slug)).toEqual(["p0", "p1", "p2"]);
    const cardKeys = Object.keys(propertyCardSchema.shape);
    for (const item of facet?.items ?? []) {
      const property = catalog.properties.find(({ slug }) => slug === item.slug);
      if (property === undefined) throw new Error(`no property ${item.slug}`);
      expect(Object.keys(item).sort()).toEqual(Object.keys(pickCard(property)).sort());
      expect(Object.keys(item).filter((key) => !cardKeys.includes(key))).toEqual([]);
      expect(item).not.toHaveProperty("gallery");
    }
  });
});
