// PERF-06: the property list sends the card fields only. 100 properties with full galleries and long stories answer a
// list that costs at most 600 bytes per item, while one property's own read still carries its gallery. The `/` HTML
// budget is `hydration.spec.ts`'s document case and Lighthouse's `document:size`.
import "./env";
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { handlePublic } from "../../src/server/public/pipeline";
import { syntheticCatalogDb } from "../fixtures/catalog-fixture";

const COUNT = 100;
const MAX_BYTES_PER_ITEM = 600;
const REQUEST_ID = "req-api-payload-0001";

const db = syntheticCatalogDb(COUNT);

function read(path: string): Promise<Response> {
  return handlePublic(new Request(`http://localhost/api/public${path}`), REQUEST_ID, db);
}

beforeAll(() => {
  process.env["CATALOG_VERSION_TTL_MS"] = "0";
});

describe("the property list payload", () => {
  it("costs at most 600 bytes per item for 100 properties with galleries", async () => {
    const response = await read("/properties");
    expect(response.status).toBe(200);
    const body = await response.text();
    const items = z.array(z.object({ slug: z.string() })).parse(JSON.parse(body));
    expect(items).toHaveLength(COUNT);
    const perItem = new TextEncoder().encode(body).length / COUNT;
    process.stdout.write(`payload: ${perItem.toFixed(1)} bytes per item\n`);
    expect(perItem).toBeLessThanOrEqual(MAX_BYTES_PER_ITEM);
  });

  it("still answers one property with its full gallery", async () => {
    const response = await read("/properties/synthetic-001");
    expect(response.status).toBe(200);
    const property = z
      .object({ slug: z.string(), gallery: z.array(z.object({ src: z.string() })) })
      .parse(await response.json());
    expect(property.slug).toBe("synthetic-001");
    expect(property.gallery.length).toBeGreaterThanOrEqual(7);
  });
});
