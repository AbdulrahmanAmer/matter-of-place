// The six catalog reads through `handlePublic` against the seeded database (`mop-dev` on the laptop, CI's stack in the
// `db` job). The edge cache does nothing in Node, so every answer is a miss; the memory layer is what these read.
import "./env";
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { handlePublic } from "../../src/server/public/pipeline";
import { committed, withRollback } from "../fixtures/db";

const REQUEST_ID = "req-api-catalog-0001";

async function call(path: string, headers?: Record<string, string>): Promise<Response> {
  return handlePublic(
    new Request(`http://localhost/api/public${path}`, headers === undefined ? {} : { headers }),
    REQUEST_ID,
  );
}

const slugs = z.array(z.object({ slug: z.string() }));

async function counts() {
  return withRollback(async (pg) => {
    const result = await pg.query<{
      properties: number;
      markets: number;
      stories: number;
      version: string;
    }>(
      `select
         (select count(*)::int from public.properties where editorial_state = 'published') as properties,
         (select count(*)::int from public.markets) as markets,
         (select count(*)::int from public.stories where editorial_state = 'published') as stories,
         (select value #>> '{}' from public.settings where key = 'catalog_version') as version`,
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error("the counts query returned no row");
    return row;
  });
}

beforeAll(() => {
  // A test that edits a row sees it at once (invariant 15).
  process.env["CATALOG_VERSION_TTL_MS"] = "0";
});

describe("the six catalog reads", () => {
  it("answers /properties with every published property and the headers of the table", async () => {
    const expected = await counts();
    const response = await call("/properties");
    expect(response.status).toBe(200);
    expect(slugs.parse(await response.json())).toHaveLength(expected.properties);
    expect(expected.properties).toBeGreaterThanOrEqual(16);
    expect(response.headers.get("cache-control")).toBe("public, max-age=60");
    expect(response.headers.get("cache-tag")).toBe("catalog");
    expect(response.headers.get("x-catalog-version")).toBe(expected.version);
    expect(response.headers.get("x-mop-cache")).toBe("miss");
    expect(response.headers.get("x-request-id")).toBe(REQUEST_ID);
  });

  it("answers a detail with its own tag, and a missing slug with the cacheable 404", async () => {
    const list = slugs.parse(await (await call("/properties")).json());
    const slug = list[0]?.slug ?? "";
    const found = await call(`/properties/${slug}`);
    expect(found.status).toBe(200);
    expect(found.headers.get("cache-tag")).toBe(`catalog,property:${slug}`);
    expect(slugs.element.parse(await found.json()).slug).toBe(slug);
    const missing = await call("/properties/nope");
    expect(missing.status).toBe(404);
    expect(missing.headers.get("cache-control")).toBe("public, s-maxage=60");
    const body = z.object({
      error: z.object({ code: z.string(), requestId: z.string().optional() }),
    });
    expect(body.parse(await missing.json()).error).toEqual({ code: "not_found" });
  });

  it("answers the markets and the stories the same way", async () => {
    const expected = await counts();
    const markets = await call("/markets");
    const stories = await call("/stories");
    expect(slugs.parse(await markets.json())).toHaveLength(expected.markets);
    expect(slugs.parse(await stories.json())).toHaveLength(expected.stories);
    const market = await call("/markets/california");
    expect(market.status).toBe(200);
    expect(market.headers.get("cache-tag")).toBe("catalog,market:california");
    const firstStory = slugs.parse(await (await call("/stories")).json())[0]?.slug ?? "";
    const story = await call(`/stories/${firstStory}`);
    expect(story.status).toBe(200);
    expect(story.headers.get("cache-tag")).toBe(`catalog,story:${firstStory}`);
    expect((await call("/markets/nowhere")).status).toBe(404);
    expect((await call("/stories/nowhere")).status).toBe(404);
  });

  it("answers 304 to the ETag it sent", async () => {
    const first = await call("/properties");
    const etag = first.headers.get("etag") ?? "";
    expect(etag).toMatch(/^W\/"cv\d+-[0-9a-f]{16}"$/);
    const second = await call("/properties", { "if-none-match": etag });
    expect(second.status).toBe(304);
    expect(await second.text()).toBe("");
  });

  it("shows an edit to a published property in a new version and in the body", async () => {
    let restore: { slug: string; place: string } | undefined;
    await committed(
      async (pg) => {
        const picked = await pg.query<{ slug: string; place: string }>(
          "select slug, place from public.properties where editorial_state = 'published' order by slug limit 1",
        );
        const row = picked.rows[0];
        if (row === undefined) throw new Error("no published property to edit");
        restore = row;
        const before = await call(`/properties/${row.slug}`);
        await pg.query("update public.properties set place = $2 where slug = $1", [
          row.slug,
          `${row.place} (api test)`,
        ]);
        const after = await call(`/properties/${row.slug}`);
        expect(after.headers.get("x-catalog-version")).not.toBe(
          before.headers.get("x-catalog-version"),
        );
        expect(z.object({ place: z.string() }).parse(await after.json()).place).toBe(
          `${row.place} (api test)`,
        );
      },
      async (pg) => {
        if (restore === undefined) return;
        await pg.query("update public.properties set place = $2 where slug = $1", [
          restore.slug,
          restore.place,
        ]);
      },
    );
  });
});
