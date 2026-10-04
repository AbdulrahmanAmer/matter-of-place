// Redirects (GD-02, GG-01) through the pipeline's `handle` with the real lookup against the seeded database: both
// sources come from the catalog snapshot, so an edit shows within an interval and a warm lookup costs no request.
import "./env";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { dbCallCount, getDb } from "../../src/server/lib/db";
import { handle } from "../../src/server/lib/pipeline";
import { resolveRedirect } from "../../src/server/public/redirects";
import { committed, type Db as Pg } from "../fixtures/db";

const OLD_SLUG = "__e2e-redirect-old";
const SUMMER = "/__e2e-summer";
const WINTER = "/__e2e-winter";

async function through(path: string) {
  const looked: string[] = [];
  const rendered: string[] = [];
  const response = await handle(
    new Request(`http://localhost${path}`),
    { env: { MOP_ENV: "local" }, waitUntil: () => undefined },
    {
      render: (request) => {
        rendered.push(new URL(request.url).pathname);
        return Promise.resolve(new Response("<p>page</p>"));
      },
      redirect: (request) => {
        looked.push(new URL(request.url).pathname);
        return resolveRedirect(request, getDb());
      },
      cache: (_request, render) => render(),
      getFlags: () => Promise.resolve({}),
      report: () => Promise.resolve(),
      isApiRoute: () => false,
    },
  );
  return { response, looked, rendered };
}

const location = (response: Response) => response.headers.get("location");

async function cleanup(pg: Pg): Promise<void> {
  await pg.query("delete from public.slug_history where slug = $1", [OLD_SLUG]);
  await pg.query("delete from public.redirects where from_path in ($1, $2)", [SUMMER, WINTER]);
}

async function publishedSlug(pg: Pg): Promise<{ id: string; slug: string }> {
  const picked = await pg.query<{ id: string; slug: string }>(
    "select id, slug from public.properties where editorial_state = 'published' order by slug limit 1",
  );
  const row = picked.rows[0];
  if (row === undefined) throw new Error("no published property");
  return row;
}

beforeAll(() => {
  process.env["CATALOG_VERSION_TTL_MS"] = "0";
});

afterAll(() => {
  Reflect.deleteProperty(process.env, "CATALOG_VERSION_TTL_MS");
});

describe("a redirect before routing", () => {
  it("answers an old slug of a published property with 301 to its current one, never stored", async () => {
    await committed(async (pg) => {
      const property = await publishedSlug(pg);
      await pg.query("insert into public.slug_history (slug, property_id) values ($1, $2)", [
        OLD_SLUG,
        property.id,
      ]);
      const { response, rendered } = await through(`/property/${OLD_SLUG}`);
      expect(response.status).toBe(301);
      expect(location(response)).toBe(`/property/${property.slug}`);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(rendered).toEqual([]);
    }, cleanup);
  });

  it("answers an enabled row with its stored status, and lets a disabled row fall through to the page", async () => {
    await committed(async (pg) => {
      await pg.query(
        `insert into public.redirects (from_path, to_path, status, enabled) values
           ($1, '/markets', 302, true), ($2, '/stories', 301, false)`,
        [SUMMER, WINTER],
      );
      const summer = await through(SUMMER);
      expect([summer.response.status, location(summer.response)]).toEqual([302, "/markets"]);
      const winter = await through(WINTER);
      expect(winter.response.status).toBe(200);
      expect(winter.rendered).toEqual([WINTER]);
    }, cleanup);
  });

  it("never looks up the API, the admin or a file, and sends an unknown slug to the page", async () => {
    for (const path of ["/api/public/properties", "/admin", "/robots.txt"]) {
      const { response, looked, rendered } = await through(path);
      expect(looked).toEqual([]);
      expect(rendered).toEqual([path]);
      expect(response.status).toBe(200);
    }
    const unknown = await through("/property/__e2e-nowhere");
    expect(unknown.looked).toEqual(["/property/__e2e-nowhere"]);
    expect(unknown.rendered).toEqual(["/property/__e2e-nowhere"]);
  });

  it("shows an edited redirect within the interval", async () => {
    await committed(async (pg) => {
      await pg.query(
        "insert into public.redirects (from_path, to_path, status) values ($1, '/markets', 302)",
        [SUMMER],
      );
      expect(location((await through(SUMMER)).response)).toBe("/markets");
      await pg.query("update public.redirects set to_path = '/stories' where from_path = $1", [
        SUMMER,
      ]);
      expect(location((await through(SUMMER)).response)).toBe("/stories");
    }, cleanup);
  });
});

describe("what a redirect costs", () => {
  it("is no database request after warm-up, 100 lookups included", async () => {
    process.env["CATALOG_VERSION_TTL_MS"] = "15000";
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date());
      await through("/property/__e2e-nowhere");
      const before = dbCallCount();
      for (let lookup = 0; lookup < 100; lookup += 1) await through("/property/__e2e-nowhere");
      expect(dbCallCount() - before).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
