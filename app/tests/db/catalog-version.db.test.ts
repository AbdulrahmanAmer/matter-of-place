// Invariant 8 (G21, F25 a): settings.catalog_version rises by one on every change to published catalog content, to
// slug_history and redirects, to markets.coming_soon and to the five public settings keys, and on nothing else.
import { readFileSync } from "node:fs";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { asRole, withRollback, type Db } from "../fixtures/db";

async function catalogVersion(db: Db): Promise<number> {
  await db.query(
    "insert into public.settings (key, value) values ('catalog_version', '1') on conflict (key) do nothing",
  );
  const read = await db.query<{ version: string }>(
    "select value #>> '{}' as version from public.settings where key = 'catalog_version'",
  );
  const version = read.rows[0]?.version;
  if (version === undefined) throw new Error("no catalog_version row");
  return Number(version);
}

/** How far one statement moves catalog_version. */
async function bumpsOf(db: Db, sql: string, params: unknown[] = []): Promise<number> {
  const before = await catalogVersion(db);
  await db.query(sql, params);
  return (await catalogVersion(db)) - before;
}

/** Runs `sql` under a savepoint and returns `ok` or `<SQLSTATE> <message>`; the transaction stays usable. */
async function attempt(db: Db, sql: string): Promise<string> {
  await db.query("savepoint attempt");
  try {
    await db.query(sql);
    await db.query("release savepoint attempt");
    return "ok";
  } catch (error) {
    await db.query("rollback to savepoint attempt");
    if (error instanceof pg.DatabaseError) return `${error.code ?? ""} ${error.message}`;
    throw error;
  }
}

/** California and Florida (kept when a seed already holds them) and one California region. */
async function catalog(db: Db): Promise<void> {
  await db.query(
    `insert into public.markets (slug, name, country, intro)
     values ('california', 'California', 'United States', 'x'), ('florida', 'Florida', 'United States', 'x')
     on conflict (slug) do nothing`,
  );
  await db.query(
    "insert into public.regions (slug, market_slug, name, intro) values ('test-east-bay', 'california', 'East Bay', 'x')",
  );
}

async function draft(db: Db, slug: string): Promise<string> {
  const inserted = await db.query<{ id: string }>(
    `insert into public.properties (slug, title, market_slug, city, state, address, type)
     values ($1, 'Test house', 'california', 'Berkeley', 'CA', '1 Test Way', 'Residence') returning id`,
    [slug],
  );
  const id = inserted.rows[0]?.id;
  if (id === undefined) throw new Error("the draft insert returned no id");
  return id;
}

/** A draft complete enough to publish (enforce_publish_gate), its photograph stored, moved to review. */
async function inReview(db: Db, slug: string): Promise<string> {
  const id = await draft(db, slug);
  await db.query(
    `update public.properties set region_slug = 'test-east-bay', neighborhood = 'Elmwood', country = 'United States',
       price = 2500000, beds = 4, baths = 3.5, interior_sq_ft = 3200, lot_acres = 0.4, year_built = 1928,
       style = 'Craftsman', place = 'A quiet street.', editorial_state = 'review'
     where id = $1`,
    [id],
  );
  await db.query(
    `insert into public.property_media (property_id, media_key, variants)
     values ($1, 'test/hero.webp', '{"hero": {"w": 1600, "h": 1067}}')`,
    [id],
  );
  return id;
}

const PUBLISH =
  "update public.properties set editorial_state = 'published', published_at = now() where id = $1";

describe("catalog_version: properties", () => {
  it("publishing a property bumps it by one", async () => {
    const bumps = await withRollback(async (db) => {
      await catalog(db);
      return bumpsOf(db, PUBLISH, [await inReview(db, "test-cv-publish")]);
    });
    expect(bumps).toBe(1);
  });

  it("editing a draft does not bump it", async () => {
    const bumps = await withRollback(async (db) => {
      await catalog(db);
      const id = await draft(db, "test-cv-draft");
      return bumpsOf(db, "update public.properties set title = 'Edited' where id = $1", [id]);
    });
    expect(bumps).toBe(0);
  });

  it("renaming a draft's slug bumps it once, through slug_history", async () => {
    const bumps = await withRollback(async (db) => {
      await catalog(db);
      const id = await draft(db, "test-cv-old");
      return bumpsOf(db, "update public.properties set slug = 'test-cv-new' where id = $1", [id]);
    });
    expect(bumps).toBe(1);
  });

  it("taking down an archived property bumps it once, for gone", async () => {
    const bumps = await withRollback(async (db) => {
      await catalog(db);
      const id = await draft(db, "test-cv-takedown");
      const archive =
        "update public.properties set editorial_state = 'archived', archived_at = now() where id = $1";
      return {
        archive: await bumpsOf(db, archive, [id]),
        takedown: await bumpsOf(
          db,
          "update public.properties set taken_down_at = now() where id = $1",
          [id],
        ),
      };
    });
    expect(bumps).toEqual({ archive: 0, takedown: 1 });
  });
});

describe("catalog_version: tables carried whole", () => {
  it("updating the catalog_version row itself does not loop", async () => {
    const version = await withRollback(async (db) => {
      await catalogVersion(db);
      await db.query("update public.settings set value = '41' where key = 'catalog_version'");
      return catalogVersion(db);
    });
    expect(version).toBe(41);
  });

  it("a redirects insert and an edit each bump it once", async () => {
    const bumps = await withRollback(async (db) => ({
      insert: await bumpsOf(
        db,
        "insert into public.redirects (from_path, to_path) values ('/test-cv-old', '/test-cv-new')",
      ),
      update: await bumpsOf(
        db,
        "update public.redirects set status = 302 where from_path = '/test-cv-old'",
      ),
    }));
    expect(bumps).toEqual({ insert: 1, update: 1 });
  });

  it("a slug_history insert and an update each bump it once", async () => {
    const bumps = await withRollback(async (db) => {
      await catalog(db);
      const id = await draft(db, "test-cv-history");
      return {
        insert: await bumpsOf(
          db,
          "insert into public.slug_history (slug, property_id) values ('test-cv-earlier', $1)",
          [id],
        ),
        update: await bumpsOf(
          db,
          "update public.slug_history set changed_at = now() where slug = 'test-cv-earlier'",
        ),
      };
    });
    expect(bumps).toEqual({ insert: 1, update: 1 });
  });

  it("flipping markets.coming_soon on every market in one statement bumps it once", async () => {
    const bumps = await withRollback(async (db) => {
      await catalog(db);
      return bumpsOf(db, "update public.markets set coming_soon = not coming_soon");
    });
    expect(bumps).toBe(1);
  });
});

describe("catalog_version: settings by key", () => {
  async function cycle(db: Db, key: string) {
    await db.query("delete from public.settings where key = $1", [key]);
    return {
      insert: await bumpsOf(db, "insert into public.settings (key, value) values ($1, '{}')", [
        key,
      ]),
      update: await bumpsOf(db, `update public.settings set value = '{"a": 1}' where key = $1`, [
        key,
      ]),
      delete: await bumpsOf(db, "delete from public.settings where key = $1", [key]),
    };
  }

  it.each(["flags", "coming_soon_global", "site", "environment", "og_static"])(
    "public key %s: insert, update and delete each bump once",
    async (key) => {
      const bumps = await withRollback((db) => cycle(db, key));
      expect(bumps).toEqual({ insert: 1, update: 1, delete: 1 });
    },
  );

  it.each(["meta", "invoice", "caption_model"])(
    "admin key %s: insert, update and delete leave it unchanged",
    async (key) => {
      const bumps = await withRollback((db) => cycle(db, key));
      expect(bumps).toEqual({ insert: 0, update: 0, delete: 0 });
    },
  );
});

describe("bump_catalog_version()", () => {
  it("returns the previous value plus one for service_role, permission denied for anon and authenticated", async () => {
    const outcomes = await withRollback(async (db) => {
      const before = await catalogVersion(db);
      const denied = async (role: "anon" | "authenticated") => {
        await db.query("savepoint role");
        await asRole(db, role);
        const result = await attempt(db, "select public.bump_catalog_version()");
        await db.query("rollback to savepoint role");
        return result;
      };
      const anon = await denied("anon");
      const authenticated = await denied("authenticated");
      await asRole(db, "service_role");
      const bumped = await db.query<{ value: string }>(
        "select public.bump_catalog_version() as value",
      );
      return { anon, authenticated, serviceRole: Number(bumped.rows[0]?.value) - before };
    });
    expect(outcomes).toEqual({
      anon: "42501 permission denied for function bump_catalog_version",
      authenticated: "42501 permission denied for function bump_catalog_version",
      serviceRole: 1,
    });
  });
});

describe("migration 12: catalog_version starts at 1", () => {
  const defaults = new URL(
    "../../supabase/migrations/20261001091100_settings_defaults.sql",
    import.meta.url,
  );

  it("starts catalog_version at 1 although the three public keys are inserted before it", async () => {
    const start = await withRollback(async (db) => {
      const trigger = await db.query(
        "select 1 from pg_trigger where tgrelid = 'public.settings'::regclass and tgname = 'settings_bump_catalog_version'",
      );
      expect(
        trigger.rowCount,
        "settings_bump_catalog_version exists, or the case proves nothing",
      ).toBe(1);
      await db.query(
        "delete from public.settings where key in ('coming_soon_global', 'site', 'environment', 'catalog_version')",
      );
      await db.query(readFileSync(defaults, "utf8"));
      const read = await db.query<{ key: string; value: string }>(
        "select key, value #>> '{}' as value from public.settings where key in ('catalog_version', 'environment', 'coming_soon_global') order by key",
      );
      return read.rows;
    });
    expect(start).toEqual([
      { key: "catalog_version", value: "1" },
      { key: "coming_soon_global", value: "false" },
      { key: "environment", value: "development" },
    ]);
  });
});
