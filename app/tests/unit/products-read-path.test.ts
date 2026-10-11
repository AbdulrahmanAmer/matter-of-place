// B18 step 3: the plans ride in the site read. 200 reads of `getPublicSite` and of `GET /api/public/site` cost one
// `public_state` call and no table read (S52); a stored value that does not parse serves the seed with one log line.
import "../fixtures/worker-env";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Json } from "../../src/db";
import type { ProductPlan } from "../../src/domain/exposure";
import { seedProducts } from "../../src/server/settings/products";
import { countingDb } from "../fixtures/db-counter";
import { fakeDb } from "../fixtures/fake-db";
import { stateJson } from "../fixtures/snapshot";

const CALLS = 200;
const ctx = { env: { MOP_ENV: "local" } };

const stored = (): ProductPlan[] =>
  seedProducts().map((plan) => (plan.id === "feature" ? { ...plan, price: 325 } : plan));

// The state memo lives in module state: a fresh module graph per test.
async function load() {
  vi.resetModules();
  return {
    service: await import("../../src/server/settings/service"),
    pipeline: await import("../../src/server/public/pipeline"),
  };
}

function stateDb(products: Json) {
  return countingDb(fakeDb({ rpc: { public_state: () => stateJson(11, { products }) } }));
}

const siteRequest = () =>
  new Request("https://matterofplace.com/api/public/site", {
    headers: { "cf-connecting-ip": "198.51.100.9" },
  });

const bodySchema = z.object({ products: z.array(z.object({ id: z.string(), price: z.number() })) });

const logged: string[] = [];

beforeEach(() => {
  vi.stubEnv("CATALOG_VERSION_TTL_MS", "15000");
  logged.length = 0;
  vi.spyOn(console, "warn").mockImplementation((line: unknown) => {
    logged.push(String(line));
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("the plans on the site read path", () => {
  it("makes one public_state call and no table read in 200 reads of getPublicSite and of the route", async () => {
    const { service, pipeline } = await load();
    const db = stateDb({ plans: stored() });
    for (let call = 0; call < CALLS; call += 1) {
      await service.getPublicSite(db, undefined, ctx);
      await pipeline.handlePublic(siteRequest(), "r1", db);
    }
    expect(db.counts.rpc).toEqual({ public_state: 1 });
    expect(db.counts.from).toEqual({});
  }, 30_000);

  it("serves the stored plans, in their order and at their stored prices", async () => {
    const { service, pipeline } = await load();
    const db = stateDb({ plans: stored() });
    expect((await service.getPublicSite(db, undefined, ctx)).products).toEqual(stored());
    const response = await pipeline.handlePublic(siteRequest(), "r1", db);
    expect(response.status).toBe(200);
    const { products } = bodySchema.parse(await response.json());
    expect(products.map((plan) => [plan.id, plan.price])).toEqual([
      ["feature", 325],
      ["reach", 695],
      ["campaign", 1495],
      ["five-features", 1250],
    ]);
  });

  it("serves the seed and logs products_invalid once in 200 reads of an invalid stored value", async () => {
    const { service } = await load();
    const invalid = { plans: stored().slice(0, 3) };
    const db = stateDb(invalid);
    const answers: ProductPlan[][] = [];
    for (let call = 0; call < CALLS; call += 1) {
      answers.push((await service.getPublicSite(db, undefined, ctx)).products);
    }
    expect(answers.every((plans) => JSON.stringify(plans) === JSON.stringify(seedProducts()))).toBe(
      true,
    );
    expect(logged.filter((line) => line.includes("products_invalid"))).toHaveLength(1);
  });

  it("serves the seed without a log line when the setting is missing", async () => {
    const { service } = await load();
    const site = await service.getPublicSite(stateDb(null), undefined, ctx);
    expect(site.products).toEqual(seedProducts());
    expect(logged.filter((line) => line.includes("products_invalid"))).toEqual([]);
  });
});
