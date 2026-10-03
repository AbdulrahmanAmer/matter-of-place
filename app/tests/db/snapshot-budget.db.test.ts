// The snapshot budget (PERF-03, B2 step 12): 100 published properties of 30 stored photographs, every photograph with
// all five G59 sizes, must serialise to at most 1,500,000 bytes through public_catalog_snapshot(). It runs inside the
// harness's rolled-back transaction. KEEP_FIXTURE=1 commits the fixture instead, so B1b step 7 and H1 can time the first
// request after bump_catalog_version(); `bun run db:reset` from main removes it (ruling H1 d).
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { variantKeys } from "../../scripts/variants";
import { asRole, committed, withRollback, type Db } from "../fixtures/db";

const PROPERTIES = 100;
const PHOTOGRAPHS = 30;
const BUDGET_BYTES = 1_500_000;

const slugOf = (property: number) => `test-sb-${String(property).padStart(3, "0")}-residence`;

/** One `property_media` row per photograph: the master key and the five sizes `MediaVariants` stores. */
function photographs(): object[] {
  const rows: object[] = [];
  for (let property = 1; property <= PROPERTIES; property += 1) {
    const slug = slugOf(property);
    for (let n = 0; n < PHOTOGRAPHS; n += 1) {
      const sha8 = createHash("sha256")
        .update(`${slug}/${String(n)}`)
        .digest("hex")
        .slice(0, 8);
      rows.push({
        slug,
        n,
        key: variantKeys(slug, n, sha8).master,
        variants: {
          thumb: { w: 320, h: 213 },
          card: { w: 720, h: 480 },
          hero: { w: 1600, h: 1067 },
          og: { w: 1200, h: 630 },
          carousel: { w: 1080, h: 1350 },
        },
      });
    }
  }
  return rows;
}

/** Builds the catalog the budget is measured on and returns the snapshot's size in bytes. */
async function snapshotBytes(db: Db): Promise<number> {
  await db.query(
    `insert into public.markets (slug, name, country, intro) values ('california', 'California', 'United States', 'x')
     on conflict (slug) do nothing`,
  );
  await db.query(
    `insert into public.regions (slug, market_slug, name, intro)
     values ('test-sb-region', 'california', 'Budget region', 'x')`,
  );
  await db.query(
    `insert into public.properties (slug, title, market_slug, city, state, address, type)
     select 'test-sb-' || lpad(n::text, 3, '0') || '-residence', 'Budget residence ' || n, 'california', 'Berkeley', 'CA',
       n || ' Test Way', 'Residence'
     from generate_series(1, $1::int) n`,
    [PROPERTIES],
  );
  await db.query(
    `update public.properties set region_slug = 'test-sb-region', neighborhood = 'Elmwood',
       country = 'United States', price = 2500000, beds = 4, baths = 3.5, interior_sq_ft = 3200, lot_acres = 0.4,
       year_built = 1928, style = 'Craftsman', place = repeat('A quiet street under old trees. ', 12)
     where slug like 'test-sb-%'`,
  );
  await db.query(
    `insert into public.property_media (property_id, media_key, variants, alt, sort_order)
     select p.id, r.key, r.variants, 'Photograph ' || r.n, r.n
     from jsonb_to_recordset($1::jsonb) as r(slug text, n int, key text, variants jsonb)
     join public.properties p on p.slug = r.slug`,
    [JSON.stringify(photographs())],
  );
  await db.query(
    "update public.properties set editorial_state = 'review' where slug like 'test-sb-%'",
  );
  await db.query(
    `update public.properties set editorial_state = 'published', published_at = now()
     where slug like 'test-sb-%'`,
  );
  await asRole(db, "service_role");
  const read = await db.query<{ bytes: number }>(
    "select octet_length(public.public_catalog_snapshot()::text) as bytes",
  );
  const row = read.rows[0];
  if (row === undefined) throw new Error("public_catalog_snapshot() returned no row");
  return row.bytes;
}

describe("the snapshot budget", () => {
  it("holds 100 published properties of 30 photographs in at most 1,500,000 bytes", async () => {
    const bytes =
      process.env["KEEP_FIXTURE"] === "1"
        ? await committed(
            async (db) => {
              await db.query("begin");
              const measured = await snapshotBytes(db);
              await db.query("commit");
              return measured;
            },
            () => Promise.resolve(),
          )
        : await withRollback(snapshotBytes);
    process.stdout.write(`snapshot ${String(bytes)} bytes for ${String(PROPERTIES)} properties\n`);
    expect(bytes).toBeLessThanOrEqual(BUDGET_BYTES);
  }, 120_000);
});
