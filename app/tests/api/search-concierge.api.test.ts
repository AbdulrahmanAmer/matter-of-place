// POST /search and POST /concierge through `handlePublic` against mop-dev (CI's stack in the `db` job). Both are
// reads of the memoised catalog: after a warm-up they cost no database call at all (S52). The catalog is the seed
// the local adapter bundles, so the local adapter is the reference for what a structured query returns.
import "./env";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { properties } from "../../src/data/properties";
import { conciergeAnswerSchema, conciergeQuestions } from "../../src/domain/contracts";
import { dbCallCount } from "../../src/server/lib/db";
import { handlePublic } from "../../src/server/public/pipeline";
import { localConcierge } from "../../src/services/local/concierge";
import { localSearch } from "../../src/services/local/search";

const REQUEST_ID = "req-api-search-0001";

let ipCounter = 0;
/** A new address per request, so the per-IP memory limits (60 and 30 a minute) never fire. */
const nextIp = () =>
  `198.40.${String(Math.floor(ipCounter / 250))}.${String((ipCounter += 1) % 250)}`;

function post(path: string, body: unknown) {
  return new Request(`http://localhost/api/public/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": nextIp() },
    body: JSON.stringify(body),
  });
}

const matchesSchema = z.array(
  z.object({ property: z.object({ slug: z.string() }), score: z.number() }),
);

async function ranked(text: string, limit = 6) {
  const response = await handlePublic(post("search", { text, limit }), REQUEST_ID);
  expect(response.status).toBe(200);
  return matchesSchema.parse(await response.json()).map((match) => ({
    slug: match.property.slug,
    score: match.score,
  }));
}

const search = async (text: string, limit = 6) =>
  (await ranked(text, limit)).map((match) => match.slug);

/** The slugs of each score, best score first. Within one score the order is the catalog's, which differs (below). */
function byScore(list: { slug: string; score: number }[]) {
  const groups = new Map<number, string[]>();
  for (const { slug, score } of list)
    groups.set(score, [...(groups.get(score) ?? []), slug].sort());
  return [...groups].sort(([a], [b]) => b - a);
}

const QUERIES = [
  "modern house with a pool under 6m",
  "waterfront estate in Florida",
  "4 bedroom brownstone in Brooklyn",
  "mid-century with views and a garden",
  "terrace courtyard original details",
];

beforeEach(() => {
  // The state memo holds for the whole file: a run slower than the default 15 seconds would otherwise count a
  // state check inside a loop.
  vi.stubEnv("CATALOG_VERSION_TTL_MS", "600000");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/public/search", () => {
  it("costs no database call after a warm-up: 50 searches move the call counter by 0", async () => {
    await search("modern house with a pool under 6m");
    const before = dbCallCount();
    for (let n = 0; n < 50; n += 1) await search(QUERIES[n % QUERIES.length] ?? "house");
    expect(dbCallCount() - before).toBe(0);
  });

  // The live list comes newest first and the bundled array is in authoring order (parity.api.test.ts), so two
  // properties of one score may swap places: the scores and the sets of each score must be the same.
  it.each(QUERIES)(
    "returns every slug the local adapter returns, with the same scores in the same order: %s",
    async (text) => {
      const local = (await localSearch.match({ text, limit: 24 })).map((m) => ({
        slug: m.property.slug,
        score: m.score,
      }));
      const live = (await ranked(text, 24)).filter((match) => match.score > 0);
      expect(local.length).toBeGreaterThan(0);
      expect(byScore(live)).toEqual(byScore(local));
      expect(live.map((match) => match.score)).toEqual(local.map((match) => match.score));
    },
  );

  it("finds a property by a word only its title holds, and ranks nothing above it", async () => {
    expect(await search("Catskills")).toEqual(["hudson-valley-stone-farmhouse"]);
  });

  it("returns the same property for a plural and its singular, in both directions (F25 g)", async () => {
    expect(await search("Catskills")).toEqual(await search("Catskill"));
    expect(await search("barns")).toEqual(await search("barn"));
    expect(await search("barn")).toContain("hudson-valley-stone-farmhouse");
  });

  it("answers 422 for an empty query and for a limit over 24", async () => {
    const empty = await handlePublic(post("search", { text: "  " }), REQUEST_ID);
    const wide = await handlePublic(post("search", { text: "house", limit: 25 }), REQUEST_ID);
    expect([empty.status, wide.status]).toEqual([422, 422]);
  });

  it("carries the catalog version and a bypassed cache", async () => {
    const response = await handlePublic(post("search", { text: "pool" }), REQUEST_ID);
    expect(Number(response.headers.get("x-catalog-version"))).toBeGreaterThan(0);
    expect(response.headers.get("x-mop-cache")).toBe("bypass");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});

describe("POST /api/public/concierge", () => {
  const slug = "tiburon-waterline";

  it("costs no database call after a warm-up: 50 questions move the call counter by 0", async () => {
    const asked = { propertySlug: slug, question: conciergeQuestions[0] };
    expect((await handlePublic(post("concierge", asked), REQUEST_ID)).status).toBe(200);
    const before = dbCallCount();
    for (let n = 0; n < 50; n += 1) {
      const question = conciergeQuestions[n % conciergeQuestions.length];
      const response = await handlePublic(
        post("concierge", { propertySlug: slug, question }),
        REQUEST_ID,
      );
      expect(response.status).toBe(200);
    }
    expect(dbCallCount() - before).toBe(0);
  });

  it.each(conciergeQuestions.filter((question) => !question.includes("similar")))(
    "answers as the local adapter does: %s",
    async (question) => {
      const response = await handlePublic(
        post("concierge", { propertySlug: slug, question }),
        REQUEST_ID,
      );
      expect(response.status).toBe(200);
      expect(conciergeAnswerSchema.parse(await response.json())).toEqual(
        await localConcierge.answer({ propertySlug: slug, question }),
      );
    },
  );

  it("names a property of the same region for the nearby question, never the one asked about", async () => {
    const response = await handlePublic(
      post("concierge", { propertySlug: slug, question: "Are there similar properties nearby?" }),
      REQUEST_ID,
    );
    const answer = conciergeAnswerSchema.parse(await response.json());
    const region = properties.find((item) => item.slug === slug)?.region;
    const siblings = properties.filter((item) => item.region === region && item.slug !== slug);
    expect(siblings.map((item) => item.slug)).toContain(answer.link?.slug);
  });

  it("answers 404 for a property that is not in the catalog", async () => {
    const response = await handlePublic(
      post("concierge", { propertySlug: "no-such-property", question: conciergeQuestions[0] }),
      REQUEST_ID,
    );
    expect(response.status).toBe(404);
  });

  it("answers 422 for a question outside the four", async () => {
    const response = await handlePublic(
      post("concierge", { propertySlug: slug, question: "What is the lowest price?" }),
      REQUEST_ID,
    );
    expect(response.status).toBe(422);
  });
});
