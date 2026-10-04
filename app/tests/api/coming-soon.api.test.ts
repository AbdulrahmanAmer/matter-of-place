// Coming-soon through the public pipeline against the seeded database: the global switch empties the catalog, a flag
// changes `getFlags` and leaves the catalog alone, and an illustrative row is listed in `local` and absent in
// `production`. The Worker under test is a second connection, so this file commits (`committed`, F22) and restores
// what it changed.
//
// `MOP_ENV` is the shell's (`MOP_ENV=production bunx vitest run --project db tests/api/coming-soon.api.test.ts`):
// `./env` sets it to `local` for every API test, so the shell's value is read first and put back once the Worker's
// modules are loaded; `readVar("MOP_ENV")` reads it at call time (G39).
import { describe, expect, it } from "vitest";
import { z } from "zod";

const requested = process.env["MOP_ENV"] === "production" ? "production" : "local";
await import("./env");
const { handlePublic } = await import("../../src/server/public/pipeline");
const { getFlags } = await import("../../src/server/lib/flags");
const { getDb } = await import("../../src/server/lib/db");
const { committed } = await import("../fixtures/db");
process.env["MOP_ENV"] = requested;
process.env["CATALOG_VERSION_TTL_MS"] = "0";

type Db = Parameters<Parameters<typeof committed>[0]>[0];

const REQUEST_ID = "req-api-coming-soon-0001";
const PLANTED = "test-b3b-illustrative";

const call = (path: string) =>
  handlePublic(new Request(`http://localhost/api/public${path}`), REQUEST_ID);

const slugs = z.array(z.object({ slug: z.string() }));
const markets = z.array(z.object({ slug: z.string(), comingSoon: z.boolean() }));

async function listed(): Promise<string[]> {
  return slugs.parse(await (await call("/properties")).json()).map((row) => row.slug);
}

async function setting(pg: Db, key: string): Promise<unknown> {
  const read = await pg.query<{ value: unknown }>(
    "select value from public.settings where key = $1",
    [key],
  );
  if (read.rows[0] === undefined) throw new Error(`no ${key} setting`);
  return read.rows[0].value;
}

const put = (pg: Db, key: string, value: unknown) =>
  pg.query("update public.settings set value = $2::jsonb where key = $1", [
    key,
    JSON.stringify(value),
  ]);

/** Puts back the settings a test changed and removes the planted row; throws when a row is left behind. */
async function cleanUp(pg: Db, original: { flag?: unknown; flags?: unknown }): Promise<void> {
  if (original.flag !== undefined) await put(pg, "coming_soon_global", original.flag);
  if (original.flags !== undefined) await put(pg, "flags", original.flags);
  await pg.query("begin");
  await pg.query("select set_config('mop.retention', 'on', true)");
  await pg.query("delete from public.properties where slug like 'test-b3b-%'");
  const left = await pg.query<{ n: number }>(
    "select count(*)::int as n from public.properties where slug like 'test-b3b-%'",
  );
  await pg.query("commit");
  if (left.rows[0]?.n !== 0) throw new Error("a test-b3b- property is left behind");
}

/** A published property of an open market, copied under a test slug and marked illustrative. */
async function plant(pg: Db): Promise<void> {
  await pg.query(
    `create temp table planted as
       select p.* from public.properties p join public.markets m on m.slug = p.market_slug
       where p.editorial_state = 'published' and not m.coming_soon limit 1`,
  );
  const copied = await pg.query(
    "update planted set id = gen_random_uuid(), slug = $1, status = 'Illustrative', hero_rank = null, featured_rank = null",
    [PLANTED],
  );
  if (copied.rowCount !== 1) throw new Error("no published property in an open market to copy");
  const written = await pg.query<{ names: string }>(
    `select string_agg(quote_ident(column_name), ', ') as names from information_schema.columns
     where table_schema = 'public' and table_name = 'properties' and is_generated = 'NEVER'`,
  );
  const names = written.rows[0]?.names ?? "";
  await pg.query(`insert into public.properties (${names}) select ${names} from planted`);
}

describe("the global coming-soon flag", () => {
  it("empties /properties, marks every market coming soon and answers a detail with 404", async () => {
    const original: { flag?: unknown } = {};
    await committed(
      async (pg) => {
        original.flag = await setting(pg, "coming_soon_global");
        const published = await pg.query<{ slug: string }>(
          "select slug from public.properties where editorial_state = 'published' limit 1",
        );
        const slug = published.rows[0]?.slug ?? "";
        expect(slug).not.toBe("");
        await put(pg, "coming_soon_global", true);
        expect(await listed()).toEqual([]);
        const all = markets.parse(await (await call("/markets")).json());
        expect(all.length).toBeGreaterThanOrEqual(3);
        expect(all.every((market) => market.comingSoon)).toBe(true);
        expect((await call(`/properties/${slug}`)).status).toBe(404);
        expect((await getFlags(getDb())).coming_soon).toBe(true);
      },
      (pg) => cleanUp(pg, original),
    );
  });
});

describe("a feature flag", () => {
  it("changes getFlags at once and leaves the catalog untouched", async () => {
    const original: { flags?: unknown } = {};
    await committed(
      async (pg) => {
        original.flags = await setting(pg, "flags");
        const before = { flags: await getFlags(getDb()), properties: await listed() };
        await put(pg, "flags", { new_channels: true, archive_pages: false });
        expect(await getFlags(getDb())).toEqual({
          ...before.flags,
          new_channels: true,
          archive_pages: false,
        });
        expect(await listed()).toEqual(before.properties);
      },
      (pg) => cleanUp(pg, original),
    );
  });
});

describe.runIf(requested === "production")("MOP_ENV production", () => {
  it("does not list a planted illustrative row", async () => {
    await committed(
      async (pg) => {
        await plant(pg);
        expect(await listed()).not.toContain(PLANTED);
      },
      (pg) => cleanUp(pg, {}),
    );
  });
});

describe.runIf(requested === "local")("MOP_ENV local", () => {
  it("lists a planted illustrative row", async () => {
    await committed(
      async (pg) => {
        await plant(pg);
        expect(await listed()).toContain(PLANTED);
      },
      (pg) => cleanUp(pg, {}),
    );
  });
});
