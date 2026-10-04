import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Json } from "../../src/db";
import { catalogDb, propertyJson } from "../fixtures/snapshot";

const answerSchema = z.array(
  z.object({
    property: z.object({ slug: z.string() }),
    score: z.number(),
    reasons: z.array(z.string()),
  }),
);

/** The snapshot row of the fixture property `slug`, with some fields replaced. */
function row(slug: string, over: Record<string, Json>): Json {
  const base = propertyJson(slug);
  if (typeof base !== "object" || base === null || Array.isArray(base)) {
    throw new Error("the fixture property is not an object");
  }
  return { ...base, ...over };
}

const properties: Json[] = [
  row("quiet-house", {
    title: "The Quiet House",
    architect: "Anselm Kerrigan",
    address: "1 Cliff Road",
  }),
  row("harbour-lofts", {
    title: "Harbour Lofts",
    designer: "Mirela Voss",
    address: "12 Alder Lane",
    city: "Sausalito",
    neighborhood: "Waterfront",
  }),
  row("orchard", {
    title: "Orchard Estate",
    place: "Above the Mendocino coast, under old oaks",
    city: "Albion",
    neighborhood: "Mendocino",
  }),
];

async function ask(text: string, limit = 6) {
  vi.resetModules();
  const { match } = await import("../../src/server/search/service");
  const db = catalogDb(7, { properties });
  const response = await match(db, { text, limit });
  const body = answerSchema.parse(await response.json());
  return { response, body, db };
}

beforeEach(() => {
  vi.stubEnv("CATALOG_VERSION_TTL_MS", "0");
});

describe("search.match", () => {
  it("finds a property by its architect, its designer, a street and a place that only the token index holds", async () => {
    expect((await ask("Kerrigan")).body.map((m) => m.property.slug)).toEqual(["quiet-house"]);
    expect((await ask("Voss")).body.map((m) => m.property.slug)).toEqual(["harbour-lofts"]);
    expect((await ask("Alder Lane")).body.map((m) => m.property.slug)).toEqual(["harbour-lofts"]);
    expect((await ask("oaks")).body.map((m) => m.property.slug)).toEqual(["orchard"]);
  });

  it("names the field that held the words", async () => {
    const [match] = (await ask("Kerrigan")).body;
    expect(match).toMatchObject({ score: 0, reasons: ["Architect"] });
  });

  it("ranks the property with more token hits first", async () => {
    const { body } = await ask("harbour lofts alder voss quiet");
    expect(body.map((m) => m.property.slug)).toEqual(["harbour-lofts", "quiet-house"]);
  });

  it("returns the same property for a plural and its singular", async () => {
    const singular = (await ask("oak")).body.map((m) => m.property.slug);
    const plural = (await ask("oaks")).body.map((m) => m.property.slug);
    expect(singular).toEqual(["orchard"]);
    expect(plural).toEqual(singular);
  });

  it("puts the matcher's score before token hits", async () => {
    // "Sausalito" is a city the matcher scores; "Kerrigan" and "Anselm" are token hits only, two of them against the one of "Sausalito".
    const { body } = await ask("Sausalito Kerrigan Anselm");
    expect(body.map((m) => m.property.slug)).toEqual(["harbour-lofts", "quiet-house"]);
    expect(body[0]?.score).toBeGreaterThan(0);
    expect(body[1]?.score).toBe(0);
  });

  it("honours the limit", async () => {
    expect((await ask("Cliff Road Alder Mendocino", 2)).body).toHaveLength(2);
  });

  it("answers no-store, with the catalog version it read through and a bypassed cache", async () => {
    const { response } = await ask("Kerrigan");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-catalog-version")).toBe("7");
    expect(response.headers.get("x-mop-cache")).toBe("bypass");
  });

  it("reads the catalog through the two RPCs and nothing else", async () => {
    const { db } = await ask("Kerrigan");
    expect(db.calls.map((call) => call.name).sort()).toEqual([
      "public_catalog_snapshot",
      "public_state",
    ]);
  });
});
