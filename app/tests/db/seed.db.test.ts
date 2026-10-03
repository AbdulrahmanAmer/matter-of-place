// What `bun run seed -- --target dev --mode full --images skip` leaves behind (B2 step 12). The test only reads: the
// rows are the seed's, written through supabase-js before the test runs, and every read runs as the service role.
import { describe, expect, it } from "vitest";
import { asRole, withRollback, type Db } from "../fixtures/db";

const SNAPSHOT_BUDGET_BYTES = 500_000;

async function one<T>(db: Db, sql: string): Promise<T> {
  const result = await db.query<{ value: T }>(`select (${sql}) as value`);
  const row = result.rows[0];
  if (row === undefined) throw new Error(`no row for ${sql}`);
  return row.value;
}

describe("the full illustrative seed", () => {
  it("leaves 16 published Illustrative properties and 3 open markets", async () => {
    await withRollback(async (db) => {
      await asRole(db, "service_role");
      expect(
        await one<string>(
          db,
          "select count(*) from public.properties where editorial_state = 'published' and status = 'Illustrative'",
        ),
      ).toBe("16");
      expect(await one<string>(db, "select count(*) from public.properties")).toBe("16");
      expect(
        await one<string>(db, "select count(*) from public.markets where coming_soon = false"),
      ).toBe("3");
    });
  });

  it("gives every property its hero image from its first photograph, keyed o/<owner>/<n>-<sha8>.webp", async () => {
    await withRollback(async (db) => {
      await asRole(db, "service_role");
      const rows = await db.query<{ slug: string; hero_image: string | null; first_key: string }>(
        `select p.slug, p.hero_image,
           (select m.media_key from public.property_media m where m.property_id = p.id order by m.sort_order, m.id limit 1) as first_key
         from public.properties p`,
      );
      expect(rows.rows.filter((row) => row.hero_image !== row.first_key)).toEqual([]);
      const keyShape = /^o\/[a-z0-9-]+\/\d+-[0-9a-f]{8}\.webp$/;
      expect(rows.rows.filter((row) => !keyShape.test(row.hero_image ?? ""))).toEqual([]);
    });
  });

  it("serves 16 properties in one snapshot under 500 KB", async () => {
    await withRollback(async (db) => {
      await asRole(db, "service_role");
      const snapshot = await one<{ properties: unknown[] }>(
        db,
        "select public.public_catalog_snapshot()",
      );
      const bytes = Buffer.byteLength(JSON.stringify(snapshot));
      process.stdout.write(`snapshot ${String(bytes)} bytes\n`);
      expect(snapshot.properties).toHaveLength(16);
      expect(bytes).toBeLessThan(SNAPSHOT_BUDGET_BYTES);
    });
  });

  it("reports every market open and illustrative content on", async () => {
    await withRollback(async (db) => {
      await asRole(db, "service_role");
      const state = await one<{
        coming_soon_markets: Record<string, boolean>;
        illustrative_content: boolean;
      }>(db, "select public.public_state()");
      expect(Object.values(state.coming_soon_markets)).toEqual([false, false, false]);
      expect(state.illustrative_content).toBe(true);
    });
  });
});
