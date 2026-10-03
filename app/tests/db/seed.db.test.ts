// What `bun run seed -- --mode full --images skip` leaves behind (B2 step 12). The test owns its rows: it runs the
// seed's own `runSeed` as the service role inside one rolled-back transaction, so it passes on an empty catalog and on
// one the seed already filled, and leaves nothing for the other db tests to trip over.
import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { runSeed, type SeedDb } from "../../scripts/seed";
import { asRole, withRollback, type Db } from "../fixtures/db";

const SNAPSHOT_BUDGET_BYTES = 500_000;

/** The seed's two writes, as SQL in the caller's transaction: the same rows, triggers and grants as supabase-js. */
function inTransaction(db: Db): SeedDb {
  const quote = (name: string) => db.escapeIdentifier(name);
  return {
    async upsert(table, rows, { onConflict, ignoreDuplicates }) {
      const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
      const keys = onConflict.split(",");
      const list = columns.map(quote).join(", ");
      const action =
        ignoreDuplicates === true
          ? "do nothing"
          : `do update set ${columns
              .filter((column) => !keys.includes(column))
              .map((column) => `${quote(column)} = excluded.${quote(column)}`)
              .join(", ")}`;
      await db.query(
        `insert into public.${quote(table)} (${list})
         select ${list} from jsonb_populate_recordset(null::public.${quote(table)}, $1::jsonb)
         on conflict (${keys.map(quote).join(", ")}) ${action}`,
        [JSON.stringify(rows)],
      );
    },
    async update(table, values, where) {
      const set = Object.keys(values).map(
        (column, index) => `${quote(column)} = $${String(index + 1)}`,
      );
      const offset = set.length;
      const match = Object.keys(where).map(
        (column, index) => `${quote(column)} = $${String(offset + index + 1)}`,
      );
      await db.query(
        `update public.${quote(table)} set ${set.join(", ")} where ${match.join(" and ")}`,
        [...Object.values(values), ...Object.values(where)],
      );
    },
  };
}

interface Facts {
  illustrative: string;
  properties: string;
  openMarkets: string;
  heroes: { slug: string; hero_image: string | null; first_key: string | null }[];
  snapshot: { properties: unknown[] };
  state: { coming_soon_markets: Record<string, boolean>; illustrative_content: boolean };
}

async function one<T>(db: Db, sql: string): Promise<T> {
  const result = await db.query<{ value: T }>(`select (${sql}) as value`);
  const row = result.rows[0];
  if (row === undefined) throw new Error(`no row for ${sql}`);
  return row.value;
}

async function readSeeded(): Promise<Facts> {
  return withRollback(async (db) => {
    // Whatever a real seed left is cleared first, so every row read below is this run of the seed (rolled back at the end).
    await db.query("select set_config('mop.retention', 'on', true)");
    await db.query("delete from public.properties");
    await db.query("delete from public.stories");
    await db.query("update public.markets set coming_soon = true");
    await asRole(db, "service_role");
    await runSeed(
      { target: "dev", mode: "full", images: "skip" },
      {
        db: inTransaction(db),
        sha8: (source) =>
          Promise.resolve(createHash("sha256").update(source).digest("hex").slice(0, 8)),
      },
    );
    const heroes = await db.query<Facts["heroes"][number]>(
      `select p.slug, p.hero_image,
         (select m.media_key from public.property_media m where m.property_id = p.id order by m.sort_order, m.id limit 1) as first_key
       from public.properties p`,
    );
    return {
      illustrative: await one<string>(
        db,
        "select count(*) from public.properties where editorial_state = 'published' and status = 'Illustrative'",
      ),
      properties: await one<string>(db, "select count(*) from public.properties"),
      openMarkets: await one<string>(
        db,
        "select count(*) from public.markets where coming_soon = false",
      ),
      heroes: heroes.rows,
      snapshot: await one<Facts["snapshot"]>(db, "select public.public_catalog_snapshot()"),
      state: await one<Facts["state"]>(db, "select public.public_state()"),
    };
  });
}

describe("the full illustrative seed", () => {
  let facts: Facts;
  beforeAll(async () => {
    facts = await readSeeded();
  }, 120_000);

  it("leaves 16 published Illustrative properties and 3 open markets", () => {
    expect({
      illustrative: facts.illustrative,
      properties: facts.properties,
      openMarkets: facts.openMarkets,
    }).toEqual({ illustrative: "16", properties: "16", openMarkets: "3" });
  });

  it("gives every property its hero image from its first photograph, keyed o/<owner>/<n>-<sha8>.webp", () => {
    const keyShape = /^o\/[a-z0-9-]+\/\d+-[0-9a-f]{8}\.webp$/;
    expect(facts.heroes).toHaveLength(16);
    expect(facts.heroes.filter((row) => row.hero_image !== row.first_key)).toEqual([]);
    expect(facts.heroes.filter((row) => !keyShape.test(row.hero_image ?? ""))).toEqual([]);
  });

  it("serves 16 properties in one snapshot under 500 KB", () => {
    const bytes = Buffer.byteLength(JSON.stringify(facts.snapshot));
    process.stdout.write(`snapshot ${String(bytes)} bytes\n`);
    expect(facts.snapshot.properties).toHaveLength(16);
    expect(bytes).toBeLessThan(SNAPSHOT_BUDGET_BYTES);
  });

  it("reports every market open and illustrative content on", () => {
    expect(Object.values(facts.state.coming_soon_markets)).toEqual([false, false, false]);
    expect(facts.state.illustrative_content).toBe(true);
  });
});
