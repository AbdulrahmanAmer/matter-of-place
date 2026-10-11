// B18 (H80). Step 1: the seed row of `settings.products`, written by `<ts>_settings_products.sql`; the trigger that
// raises catalog_version on a save is shown by catalog-version.db.test.ts, the eight-key state by public-reads.db.test.ts.
// Step 2: `settings_put_products`, which each case creates from its migration file, so a mutation of that file is
// what the case runs; the step 1 migration and the action_roles row come from the prelude until main pushes them.
import { readdirSync, readFileSync } from "node:fs";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { seedOfferings } from "../../src/data/exposure";
import { plansFromOfferings, productsSettingSchema } from "../../src/domain/exposure";
import { asRole, createStaffUser, withRollback, type Db } from "../fixtures/db";

const MIGRATIONS = "supabase/migrations";

function migration(suffix = "_settings_products.sql"): string {
  const files = readdirSync(MIGRATIONS).filter((name) => name.endsWith(suffix));
  const file = files[0];
  if (files.length !== 1 || file === undefined) throw new Error(`expected one ${suffix} migration`);
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
    expect(productsSettingSchema.parse(rows[0])).toEqual({
      plans: plansFromOfferings(seedOfferings),
    });
  });

  it("is run twice and leaves one row, an edit kept and the version where the first run left it", async () => {
    const edited = {
      plans: plansFromOfferings(seedOfferings).map((plan) => ({ ...plan, price: 9 })),
    };
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

const PUT = "select public.settings_put_products($1::jsonb, $2, 'human', 'r-products', $3)";

/** `ok`, or the SQLSTATE, message and detail of the refusal; a savepoint keeps the transaction usable (G-102). */
async function attempt(db: Db, sql: string, params: unknown[] = []): Promise<string> {
  await db.query("savepoint attempt");
  try {
    await db.query(sql, params);
    await db.query("release savepoint attempt");
    return "ok";
  } catch (error) {
    await db.query("rollback to savepoint attempt");
    if (error instanceof pg.DatabaseError) {
      return [error.code, error.message, error.detail].filter(Boolean).join(" ");
    }
    throw error;
  }
}

/** The write function as its migration creates it, and an admin who may call it through `write_audit`. */
async function prepared(db: Db): Promise<string> {
  await db.query(migration("_settings_put_products.sql"));
  return createStaffUser(db, ["admin"]);
}

const audited = async (db: Db) =>
  (
    await db.query<{
      action: string;
      entity: string;
      before: unknown;
      after: unknown;
      note: string;
    }>(
      "select action, entity, before, after, note from public.audit_log where request_id = 'r-products' order by id",
    )
  ).rows;

const seed = plansFromOfferings(seedOfferings);
const withPrice = (price: unknown) =>
  seed.map((plan, index) => (index === 0 ? { ...plan, price } : plan));

describe("settings_put_products", () => {
  it("saves the plans, writes one audit row with the before and after values and the note, and moves catalog_version by 1", async () => {
    const edited = { plans: withPrice(325) };
    const result = await withRollback(async (db) => {
      const admin = await prepared(db);
      const [before] = await stored(db);
      const version0 = await version(db);
      const outcome = await attempt(db, PUT, [JSON.stringify(edited), admin, "admin: settings"]);
      return {
        outcome,
        before,
        rows: await stored(db),
        moved: (await version(db)) - version0,
        audit: await audited(db),
      };
    });
    expect({ ...result, before: productsSettingSchema.parse(result.before) }).toEqual({
      outcome: "ok",
      before: { plans: seed },
      rows: [edited],
      moved: 1,
      audit: [
        {
          action: "settings.products_put",
          entity: "settings.products",
          before: result.before,
          after: edited,
          note: "admin: settings",
        },
      ],
    });
  });

  it("refuses three plans with 'adding or removing a plan needs a migration' and leaves no row, no audit row and no version bump", async () => {
    const result = await withRollback(async (db) => {
      const admin = await prepared(db);
      const rows = await stored(db);
      const version0 = await version(db);
      const outcome = await attempt(db, PUT, [
        JSON.stringify({ plans: seed.slice(0, 3) }),
        admin,
        "admin: settings",
      ]);
      return {
        outcome,
        unchanged: JSON.stringify(await stored(db)) === JSON.stringify(rows),
        moved: (await version(db)) - version0,
        audit: await audited(db),
      };
    });
    expect(result).toEqual({
      outcome: "22023 validation adding or removing a plan needs a migration",
      unchanged: true,
      moved: 0,
      audit: [],
    });
  });

  it("keeps the before value of each of two saves in a row: the last write wins (invariant 11)", async () => {
    const first = { plans: withPrice(300) };
    const second = { plans: withPrice(310) };
    const result = await withRollback(async (db) => {
      const admin = await prepared(db);
      const [original] = await stored(db);
      const outcomes = [
        await attempt(db, PUT, [JSON.stringify(first), admin, "first"]),
        await attempt(db, PUT, [JSON.stringify(second), admin, "second"]),
      ];
      const audit = (await audited(db)).map((row) => ({ before: row.before, after: row.after }));
      return { original, outcomes, rows: await stored(db), audit };
    });
    expect(result).toEqual({
      original: result.original,
      outcomes: ["ok", "ok"],
      rows: [second],
      audit: [
        { before: result.original, after: first },
        { before: first, after: second },
      ],
    });
  });

  it("cannot be executed by anon or authenticated", async () => {
    const outcomes = await withRollback(async (db) => {
      const admin = await prepared(db);
      const denied = async (role: "anon" | "authenticated") => {
        await db.query("savepoint role");
        await asRole(db, role, admin);
        const outcome = await attempt(db, PUT, [JSON.stringify({ plans: seed }), admin, "x"]);
        await db.query("rollback to savepoint role");
        return outcome;
      };
      return { anon: await denied("anon"), authenticated: await denied("authenticated") };
    });
    expect(outcomes).toEqual({
      anon: "42501 permission denied for function settings_put_products",
      authenticated: "42501 permission denied for function settings_put_products",
    });
  });

  it("gives every value of the table the verdict productsSettingSchema gives it (invariant 2)", async () => {
    const replaced = (index: number, plan: unknown) =>
      seed.map((other, at) => (at === index ? plan : other));
    const table: [string, unknown][] = [
      ["the seed", { plans: seed }],
      ["the seed in another order", { plans: [...seed].reverse() }],
      ["no plan recommended", { plans: seed.map((plan) => ({ ...plan, recommended: false })) }],
      ["a price of 1", { plans: withPrice(1) }],
      ["a price of 1,000,000", { plans: withPrice(1_000_000) }],
      ["three plans", { plans: seed.slice(0, 3) }],
      ["five plans", { plans: [...seed, { ...seed[0], name: "The Fifth" }] }],
      ["an id twice", { plans: replaced(1, { ...seed[1], id: "feature" }) }],
      ["an id that is not bound", { plans: replaced(1, { ...seed[1], id: "premium" }) }],
      ["a plan that is not an object", { plans: replaced(3, 7) }],
      ["a price of 0", { plans: withPrice(0) }],
      ["a negative price", { plans: withPrice(-5) }],
      ["a price over 1,000,000", { plans: withPrice(1_000_001) }],
      ["a decimal price", { plans: withPrice(2.5) }],
      ["a price as a string", { plans: withPrice("295") }],
      [
        "two plans recommended",
        { plans: seed.map((plan, at) => ({ ...plan, recommended: at < 2 })) },
      ],
      ["a flag that is not a boolean", { plans: replaced(0, { ...seed[0], recommended: "yes" }) }],
      ["an array", seed],
      ["no plans key", {}],
      ["plans that are not a list", { plans: "four" }],
    ];
    const sql = await withRollback(async (db) => {
      const admin = await prepared(db);
      const verdicts: string[] = [];
      for (const [label, value] of table) {
        const outcome = await attempt(db, PUT, [JSON.stringify(value), admin, label]);
        verdicts.push(`${label}: ${outcome === "ok" ? "accepted" : "refused"}`);
      }
      return verdicts;
    });
    const zod = table.map(
      ([label, value]) =>
        `${label}: ${productsSettingSchema.safeParse(value).success ? "accepted" : "refused"}`,
    );
    expect({ sql, accepted: zod.filter((line) => line.endsWith("accepted")).length }).toEqual({
      sql: zod,
      accepted: 5,
    });
  });
});
