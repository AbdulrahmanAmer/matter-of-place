// Operator, 2026-10-12: a property entered by hand is a draft, source Editorial, status Active (never Illustrative),
// in its market's state, with a slug from its city, and refuses an unknown market or a price of zero.
import { describe, expect, it } from "vitest";
import { withRollback, type Db } from "../fixtures/db";

async function failure(db: Db, sql: string): Promise<string> {
  await db.query("savepoint attempt");
  try {
    await db.query(sql);
    return "no error";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  } finally {
    await db.query("rollback to savepoint attempt");
  }
}

describe("create_property_editorial", () => {
  it("makes a draft: Editorial, Active, the market's state and a slug from the city", async () => {
    const row = await withRollback(async (db) => {
      const made = await db.query<{ id: string }>(
        `select (public.create_property_editorial('The Glass Pavilion', 'new-york', 'East Hampton', '12 Dune Road',
          'Estate', null, 'human', 'req-1', 12500000) ->> 'property_id') as id`,
      );
      const read = await db.query<{
        source: string;
        status: string;
        state: string;
        editorial_state: string;
        slug: string;
        price: string;
      }>(
        "select source, status, state, editorial_state, slug, price::text from public.properties where id = $1",
        [made.rows[0]?.id],
      );
      return read.rows[0];
    });
    expect(row).toMatchObject({
      source: "Editorial",
      status: "Active",
      state: "New York",
      editorial_state: "draft",
      price: "12500000.00",
    });
    expect(row?.slug).toMatch(/^east-hampton-[0-9a-f]{8}$/);
  });

  it("refuses an unknown market and a price of zero", async () => {
    const outcome = await withRollback(async (db) => ({
      market: await failure(
        db,
        "select public.create_property_editorial('A', 'texas', 'Austin', '1 Main', 'Residence', null, 'human', 'r')",
      ),
      price: await failure(
        db,
        "select public.create_property_editorial('A', 'florida', 'Miami', '1 Main', 'Residence', null, 'human', 'r', 0)",
      ),
    }));
    expect(outcome).toEqual({ market: "validation", price: "validation" });
  });
});
