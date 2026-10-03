// The warm-read contract of architecture 13 (S52, F24, invariant 18): a warm public read costs no database call, the
// version check costs one per interval, and a change that bumps `catalog_version` costs two on the first call after it.
// Every call goes through `handlePublic` with the default client, whose counted fetch is what `dbCallCount` reads.
import "./env";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { dbCallCount, resetDbCallCount } from "../../src/server/lib/db";
import { handlePublic } from "../../src/server/public/pipeline";
import { committed, type Db as Pg } from "../fixtures/db";

const INTERVAL_MS = 15_000;
const REQUEST_ID = "req-api-cache-00001";

const slugs = z.array(z.object({ slug: z.string() }));

async function call(path: string): Promise<Response> {
  return handlePublic(new Request(`http://localhost/api/public${path}`), REQUEST_ID);
}

const version = (response: Response): string => response.headers.get("x-catalog-version") ?? "";

/** The six GET routes, with a slug each for the two details. */
async function sixRoutes(): Promise<string[]> {
  const property = slugs.parse(await (await call("/properties")).json())[0]?.slug ?? "";
  const story = slugs.parse(await (await call("/stories")).json())[0]?.slug ?? "";
  return [
    "/properties",
    `/properties/${property}`,
    "/markets",
    "/markets/california",
    "/stories",
    `/stories/${story}`,
  ];
}

/** Calls each route once and returns how many database requests that made. */
async function costOfRound(routes: string[]): Promise<number> {
  const before = dbCallCount();
  for (const route of routes) expect((await call(route)).status).toBe(200);
  return dbCallCount() - before;
}

function later(): void {
  vi.setSystemTime(new Date(Date.now() + INTERVAL_MS));
}

/** Changes something that must bump the version, calls once after the interval, and puts it back. */
async function bumpsVersion(change: (pg: Pg) => Promise<void>, restore: (pg: Pg) => Promise<void>) {
  const before = version(await call("/properties"));
  await committed(async (pg) => {
    await change(pg);
    later();
  }, restore);
  const after = version(await call("/properties"));
  return { before, after };
}

beforeAll(() => {
  process.env["CATALOG_VERSION_TTL_MS"] = String(INTERVAL_MS);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date());
});

afterAll(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(process.env, "CATALOG_VERSION_TTL_MS");
});

describe("what a read costs the database", () => {
  it("costs two requests to warm, then none for 200 more across the six routes", async () => {
    resetDbCallCount();
    const routes = await sixRoutes();
    expect(dbCallCount()).toBe(2);
    expect(await costOfRound(routes)).toBe(0);
    let spent = 0;
    for (let round = 0; round < 33; round += 1) spent += await costOfRound(routes);
    expect(spent).toBe(0);
  });

  it("costs one request, the state check, when the interval has passed and the version has not moved", async () => {
    const routes = await sixRoutes();
    later();
    const before = dbCallCount();
    expect((await call(routes[0] ?? "")).status).toBe(200);
    expect(dbCallCount() - before).toBe(1);
    expect(await costOfRound(routes)).toBe(0);
  });

  it("costs two more when a published property was edited, and shows the new version", async () => {
    let original: { slug: string; place: string } | undefined;
    const before = version(await call("/properties"));
    await committed(
      async (pg) => {
        const picked = await pg.query<{ slug: string; place: string }>(
          "select slug, place from public.properties where editorial_state = 'published' order by slug limit 1",
        );
        original = picked.rows[0];
        if (original === undefined) throw new Error("no published property to edit");
        await pg.query("update public.properties set place = $2 where slug = $1", [
          original.slug,
          `${original.place} (cache test)`,
        ]);
      },
      async (pg) => {
        if (original === undefined) return;
        await pg.query("update public.properties set place = $2 where slug = $1", [
          original.slug,
          original.place,
        ]);
      },
    );
    later();
    const calls = dbCallCount();
    const first = await call("/properties");
    expect(dbCallCount() - calls).toBe(2);
    expect(version(first)).not.toBe(before);
    expect(await costOfRound(await sixRoutes())).toBe(0);
  });
});

describe("a change to the public settings reaches every cached page without an application call (F25 a, G21)", () => {
  it("changes the version when the flags row changes", async () => {
    let existed: string | undefined;
    const { before, after } = await bumpsVersion(
      async (pg) => {
        const found = await pg.query<{ value: string }>(
          "select value::text as value from public.settings where key = 'flags'",
        );
        existed = found.rows[0]?.value;
        await pg.query(
          `insert into public.settings (key, value) values ('flags', '{"__cache_test": true}')
           on conflict (key) do update set value = public.settings.value || '{"__cache_test": true}'`,
        );
      },
      async (pg) => {
        if (existed === undefined)
          await pg.query("delete from public.settings where key = 'flags'");
        else
          await pg.query("update public.settings set value = $1::jsonb where key = 'flags'", [
            existed,
          ]);
      },
    );
    expect(after).not.toBe(before);
  });

  it("changes the version when coming_soon_global changes", async () => {
    let original: string | undefined;
    const { before, after } = await bumpsVersion(
      async (pg) => {
        const found = await pg.query<{ value: string }>(
          "select value::text as value from public.settings where key = 'coming_soon_global'",
        );
        original = found.rows[0]?.value;
        await pg.query(
          `update public.settings set value = to_jsonb(not coalesce((value #>> '{}')::boolean, false))
           where key = 'coming_soon_global'`,
        );
      },
      async (pg) => {
        if (original !== undefined) {
          await pg.query(
            "update public.settings set value = $1::jsonb where key = 'coming_soon_global'",
            [original],
          );
        }
      },
    );
    expect(after).not.toBe(before);
  });

  it("changes the version when a market's coming_soon changes", async () => {
    let original: boolean | undefined;
    const { before, after } = await bumpsVersion(
      async (pg) => {
        const found = await pg.query<{ coming_soon: boolean }>(
          "select coming_soon from public.markets where slug = 'california'",
        );
        original = found.rows[0]?.coming_soon;
        await pg.query(
          "update public.markets set coming_soon = not coming_soon where slug = 'california'",
        );
      },
      async (pg) => {
        if (original !== undefined) {
          await pg.query("update public.markets set coming_soon = $1 where slug = 'california'", [
            original,
          ]);
        }
      },
    );
    expect(after).not.toBe(before);
  });

  it("leaves the version alone for a settings key outside the public ones", async () => {
    const { before, after } = await bumpsVersion(
      async (pg) => {
        await pg.query(
          "insert into public.settings (key, value) values ('__test_private', '{}') on conflict (key) do nothing",
        );
      },
      async (pg) => {
        await pg.query("delete from public.settings where key = '__test_private'");
      },
    );
    expect(after).toBe(before);
  });
});
