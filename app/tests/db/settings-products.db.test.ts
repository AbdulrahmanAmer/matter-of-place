// B18 step 1 (H80): the seed row of `settings.products`, written by `<ts>_settings_products.sql`. The trigger that
// raises catalog_version on a save is shown by catalog-version.db.test.ts, the eight-key state by public-reads.db.test.ts.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { offerings } from "../../src/data/exposure";
import { plansFromOfferings, productsSettingSchema } from "../../src/domain/exposure";
import { withRollback, type Db } from "../fixtures/db";

const MIGRATIONS = "supabase/migrations";

function migration(): string {
  const files = readdirSync(MIGRATIONS).filter((name) => name.endsWith("_settings_products.sql"));
  const file = files[0];
  if (files.length !== 1 || file === undefined)
    throw new Error("expected one settings_products migration");
  return readFileSync(`${MIGRATIONS}/${file}`, "utf8");
}

const stored = async (db: Db) => {
  const read = await db.query<{ value: unknown }>(
    "select value from public.settings where key = 'products'",
  );
  return read.rows.map((row) => row.value);
};

const version = async (db: Db) => {
  const read = await db.query<{ version: string }>(
    "select value #>> '{}' as version from public.settings where key = 'catalog_version'",
  );
  return Number(read.rows[0]?.version);
};

describe("settings.products: the seed row", () => {
  it("is written by the migration, parses with the schema and equals the plans of exposure.ts", async () => {
    const rows = await withRollback(async (db) => {
      await db.query("delete from public.settings where key = 'products'");
      await db.query(migration());
      return stored(db);
    });
    expect(rows).toHaveLength(1);
    expect(productsSettingSchema.parse(rows[0])).toEqual({ plans: plansFromOfferings(offerings) });
  });

  it("is run twice and leaves one row, an edit kept and the version where the first run left it", async () => {
    const edited = { plans: plansFromOfferings(offerings).map((plan) => ({ ...plan, price: 9 })) };
    const result = await withRollback(async (db) => {
      await db.query("delete from public.settings where key = 'products'");
      await db.query(migration());
      await db.query("update public.settings set value = $1 where key = 'products'", [
        JSON.stringify(edited),
      ]);
      const before = await version(db);
      await db.query(migration());
      return { rows: await stored(db), moved: (await version(db)) - before };
    });
    expect(result.rows).toEqual([edited]);
    expect(result.moved).toBe(0);
  });
});
