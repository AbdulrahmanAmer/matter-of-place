// Invariant 1 (S30, ruling H35): production cannot contain an Illustrative property. The refuse_illustrative_in_production
// trigger raises on insert or update, and set_environment('production') refuses while one exists.
import pg from "pg";
import { describe, expect, it } from "vitest";
import { asRole, withRollback, type Db } from "../fixtures/db";

/** Runs `sql` under a savepoint and returns `ok` or `<SQLSTATE> <message>`; the transaction stays usable. */
async function attempt(db: Db, sql: string, params: unknown[] = []): Promise<string> {
  await db.query("savepoint attempt");
  try {
    await db.query(sql, params);
    await db.query("release savepoint attempt");
    return "ok";
  } catch (error) {
    await db.query("rollback to savepoint attempt");
    if (error instanceof pg.DatabaseError) return `${error.code ?? ""} ${error.message}`;
    throw error;
  }
}

const PLANT = `insert into public.properties (slug, title, market_slug, city, state, address, type, status)
  values ($1, 'Test house', 'california', 'Berkeley', 'CA', '1 Test Way', 'Residence', $2::public.listing_status)`;

/** California, then the database moved to `development` through the function itself. */
async function development(db: Db): Promise<void> {
  await db.query(
    `insert into public.markets (slug, name, country, intro)
     values ('california', 'California', 'United States', 'x') on conflict (slug) do nothing`,
  );
  await db.query("select public.set_environment('development')");
}

/** Every Illustrative row goes, the planted one and any seeded one (refuse_hard_delete lets retention delete). */
async function withoutIllustrative(db: Db): Promise<void> {
  await db.query("select set_config('mop.retention', 'on', true)");
  await db.query("delete from public.properties where status = 'Illustrative'");
}

async function environment(db: Db): Promise<string | undefined> {
  const read = await db.query<{ value: string }>(
    "select value #>> '{}' as value from public.settings where key = 'environment'",
  );
  return read.rows[0]?.value;
}

const TO_PRODUCTION = "select public.set_environment('production')";

describe("illustrative guard", () => {
  it("allows an illustrative insert in development and refuses production while one exists", async () => {
    const outcomes = await withRollback(async (db) => {
      await development(db);
      const insert = await attempt(db, PLANT, ["test-b3b-guard-dev", "Illustrative"]);
      const production = await attempt(db, TO_PRODUCTION);
      return { insert, production, environment: await environment(db) };
    });
    expect(outcomes).toEqual({
      insert: "ok",
      production: "P0001 illustrative_in_production",
      environment: "development",
    });
  });

  it("set_environment('production') succeeds once none is left and writes one system audit row", async () => {
    const outcome = await withRollback(async (db) => {
      await development(db);
      await db.query(PLANT, ["test-b3b-guard-gone", "Illustrative"]);
      await withoutIllustrative(db);
      const before = await db.query<{ id: string }>(
        "select coalesce(max(id), 0) as id from public.audit_log",
      );
      const production = await attempt(db, TO_PRODUCTION);
      const rows = await db.query(
        `select action, entity, entity_id, actor_id, actor_kind, note, before, after
         from public.audit_log where id > $1 and action = 'settings.environment_set'`,
        [before.rows[0]?.id],
      );
      return { production, environment: await environment(db), rows: rows.rows };
    });
    expect(outcome).toEqual({
      production: "ok",
      environment: "production",
      rows: [
        {
          action: "settings.environment_set",
          entity: "settings.environment",
          entity_id: null,
          actor_id: null,
          actor_kind: null,
          note: "system",
          before: "development",
          after: "production",
        },
      ],
    });
  });

  it("in production an illustrative insert and an update to Illustrative both raise", async () => {
    const outcomes = await withRollback(async (db) => {
      await development(db);
      await db.query(PLANT, ["test-b3b-guard-active", "Active"]);
      await withoutIllustrative(db);
      await db.query(TO_PRODUCTION);
      return {
        insert: await attempt(db, PLANT, ["test-b3b-guard-prod", "Illustrative"]),
        update: await attempt(
          db,
          "update public.properties set status = 'Illustrative' where slug = 'test-b3b-guard-active'",
        ),
      };
    });
    expect(outcomes).toEqual({
      insert: "P0001 illustrative_in_production",
      update: "P0001 illustrative_in_production",
    });
  });

  it("both functions run with an empty search_path", async () => {
    const configs = await withRollback(
      async (db) =>
        (
          await db.query<{ proname: string; proconfig: string[] | null }>(
            `select proname, proconfig from pg_proc
             where proname in ('set_environment', 'refuse_illustrative_in_production') order by proname`,
          )
        ).rows,
    );
    expect(configs).toEqual([
      { proname: "refuse_illustrative_in_production", proconfig: ['search_path=""'] },
      { proname: "set_environment", proconfig: ['search_path=""'] },
    ]);
  });

  it("refuses an environment outside development, preview and production", async () => {
    const outcome = await withRollback(async (db) => {
      const staging = await attempt(db, "select public.set_environment('staging')");
      return { staging, environment: await environment(db) };
    });
    expect(outcome.staging).toBe("P0001 invalid_environment");
    expect(outcome.environment).not.toBe("staging");
  });

  it("anon and authenticated get permission denied on set_environment", async () => {
    const outcomes = await withRollback(async (db) => {
      const denied = async (role: "anon" | "authenticated") => {
        await db.query("savepoint role");
        await asRole(db, role);
        const result = await attempt(db, "select public.set_environment('preview')");
        await db.query("rollback to savepoint role");
        return result;
      };
      return { anon: await denied("anon"), authenticated: await denied("authenticated") };
    });
    expect(outcomes).toEqual({
      anon: "42501 permission denied for function set_environment",
      authenticated: "42501 permission denied for function set_environment",
    });
  });
});
