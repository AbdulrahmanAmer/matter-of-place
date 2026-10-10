// Gone pages (GP-03, invariant 10) against a running site: a taken-down property answers 410 from its page and from
// the API, an unpublished draft and an unknown slug answer 404. The site is the live-mode dev server on
// E2E_BASE_URL (for example http://localhost:8080), started with `VITE_API_BASE_URL=/api/public` and
// `CATALOG_VERSION_TTL_MS=0` so the fixture rows show at once. The rows are committed (`committed`, F22) because
// that server is another connection, and they are deleted again in `cleanup`. The CI db job starts no web server and
// sets no E2E_BASE_URL, so without it the file is skipped (R48); the proof sets it.
import "./env";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { committed, type Db } from "../fixtures/db";

const BASE = process.env["E2E_BASE_URL"] ?? "";
const TAKEN_DOWN = "test-b13-taken-down";
const DRAFT = "test-b13-draft";
const UNKNOWN = "test-b13-never-existed";

async function plant(pg: Db): Promise<void> {
  await pg.query(
    `create temp table planted as
       select p.* from public.properties p join public.markets m on m.slug = p.market_slug
       where p.editorial_state = 'published' and not m.coming_soon limit 1`,
  );
  const copied = await pg.query(
    "update planted set id = gen_random_uuid(), slug = $1, hero_rank = null, featured_rank = null",
    [TAKEN_DOWN],
  );
  if (copied.rowCount !== 1) throw new Error("no published property in an open market to copy");
  const written = await pg.query<{ names: string }>(
    `select string_agg(quote_ident(column_name), ', ') as names from information_schema.columns
     where table_schema = 'public' and table_name = 'properties' and is_generated = 'NEVER'`,
  );
  const names = written.rows[0]?.names ?? "";
  await pg.query(
    `update planted set editorial_state = 'archived', published_at = null, archived_at = now(), taken_down_at = null`,
  );
  await pg.query(`insert into public.properties (${names}) select ${names} from planted`);
  // The takedown is an update: that is what bumps the catalog version, as B7's takedown does.
  await pg.query("update public.properties set taken_down_at = now() where slug = $1", [
    TAKEN_DOWN,
  ]);
  await pg.query(
    `update planted set id = gen_random_uuid(), slug = $1, editorial_state = 'draft', published_at = null,
       taken_down_at = null, archived_at = null`,
    [DRAFT],
  );
  await pg.query(`insert into public.properties (${names}) select ${names} from planted`);
}

async function cleanup(pg: Db): Promise<void> {
  await pg.query("begin");
  await pg.query("select set_config('mop.retention', 'on', true)");
  await pg.query("delete from public.properties where slug in ($1, $2)", [TAKEN_DOWN, DRAFT]);
  const left = await pg.query<{ n: number }>(
    "select count(*)::int as n from public.properties where slug in ($1, $2)",
    [TAKEN_DOWN, DRAFT],
  );
  await pg.query("commit");
  if (left.rows[0]?.n !== 0) throw new Error("a test-b13- property is left behind");
}

const errorBody = z.object({ error: z.object({ code: z.string() }) });

describe.skipIf(BASE === "")(
  "a taken-down property (skipped without E2E_BASE_URL, the site it fetches)",
  () => {
    it("answers 410 from its page, with noindex, and 410 gone from the API; a draft and an unknown slug answer 404", async () => {
      await committed(async (pg) => {
        await plant(pg);
        const page = await fetch(`${BASE}/property/${TAKEN_DOWN}`, {
          headers: { accept: "text/html" },
        });
        expect(page.status).toBe(410);
        expect(await page.text()).toContain("noindex");

        const api = await fetch(`${BASE}/api/public/properties/${TAKEN_DOWN}`);
        expect(api.status).toBe(410);
        expect(errorBody.parse(await api.json()).error.code).toBe("gone");

        for (const slug of [DRAFT, UNKNOWN]) {
          const missing = await fetch(`${BASE}/api/public/properties/${slug}`);
          expect(missing.status).toBe(404);
          expect(errorBody.parse(await missing.json()).error.code).toBe("not_found");
          const missingPage = await fetch(`${BASE}/property/${slug}`, {
            headers: { accept: "text/html" },
          });
          expect(missingPage.status).toBe(404);
        }
      }, cleanup);
    });
  },
);
