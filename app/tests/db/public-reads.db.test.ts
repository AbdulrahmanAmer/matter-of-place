// The caching contract's database half (architecture 13 rule 1, F24, F25 b, invariant 16): public_state() and
// public_catalog_snapshot() are the only public reads, one statement each, for the service role only.
import pg from "pg";
import { describe, expect, it } from "vitest";
import { asRole, withRollback, type Db } from "../fixtures/db";
import { publicMediaKeys, publicPropertyKeys, publicStoryKeys } from "./schema-manifest";

type Row = Record<string, unknown>;
type PropertyObject = Row & { slug: string; media: Row[] };
interface Snapshot {
  catalog_version: number;
  markets: Row[];
  regions: Row[];
  properties: PropertyObject[];
  stories: Row[];
  redirects: Row[];
  slug_history: Row[];
  gone: string[];
}
interface State {
  catalog_version: number;
  flags: unknown;
  og_static: unknown;
  site: Row;
  illustrative_content: boolean;
}

const sortedKeys = (row: object) => Object.keys(row).sort();

async function setting(db: Db, key: string, value: unknown): Promise<void> {
  await db.query(
    `insert into public.settings (key, value) values ($1, $2)
     on conflict (key) do update set value = excluded.value`,
    [key, JSON.stringify(value)],
  );
}

async function state(db: Db): Promise<State> {
  const read = await db.query<{ state: State }>("select public.public_state() as state");
  const row = read.rows[0];
  if (row === undefined) throw new Error("public_state() returned no row");
  return row.state;
}

async function snapshot(db: Db): Promise<Snapshot> {
  const read = await db.query<{ snapshot: Snapshot }>(
    "select public.public_catalog_snapshot() as snapshot",
  );
  const row = read.rows[0];
  if (row === undefined) throw new Error("public_catalog_snapshot() returned no row");
  return row.snapshot;
}

const VARIANTS = JSON.stringify({ card: { w: 800, h: 533, webp: "test/card.webp" } });

async function insertId(db: Db, sql: string, params: unknown[]): Promise<string> {
  const inserted = await db.query<{ id: string }>(`${sql} returning id`, params);
  const id = inserted.rows[0]?.id;
  if (id === undefined) throw new Error("the insert returned no id");
  return id;
}

const DRAFT = `insert into public.properties (slug, title, market_slug, city, state, address, type)
  values ($1, 'Test house', 'california', 'Berkeley', 'CA', '1 Test Way', 'Residence')`;
const COMPLETE = `update public.properties set region_slug = 'test-east-bay', neighborhood = 'Elmwood',
    country = 'United States', price = 2500000, beds = 4, baths = 3.5, interior_sq_ft = 3200, lot_acres = 0.4,
    year_built = 1928, style = 'Craftsman', place = 'A quiet street.'
  where id = $1`;
const STORED_MEDIA = `insert into public.property_media (property_id, media_key, variants, alt)
  values ($1, 'test/hero.webp', '{"hero": {"w": 1600, "h": 1067}}', 'The house')`;
const TO_STATE = "update public.properties set editorial_state = $2 where id = $1";
const PUBLISH =
  "update public.properties set editorial_state = 'published', published_at = now() where id = $1";
const STORY = `insert into public.stories (slug, title, deck, category, market_slug, image, image_variants,
    editorial_state, published_at, archived_at)
  values ($1, 'Test story', 'x', 'Places', 'california', 'test/story.webp', $2, $3::public.editorial_state,
    case when $3::text = 'published' then now() end, case when $3::text = 'archived' then now() end)`;

/** A complete draft with its photograph stored (enforce_publish_gate), ready for review. */
async function completeDraft(db: Db, slug: string): Promise<string> {
  const id = await insertId(db, DRAFT, [slug]);
  await db.query(COMPLETE, [id]);
  await db.query(STORED_MEDIA, [id]);
  return id;
}

/** One property and one story in every editorial state, two redirects, a renamed draft and a staged photograph. */
async function catalogFixture(db: Db): Promise<{ draftId: string }> {
  await setting(db, "catalog_version", 1);
  await db.query(
    `insert into public.markets (slug, name, country, intro)
     values ('california', 'California', 'United States', 'x'), ('florida', 'Florida', 'United States', 'x')
     on conflict (slug) do nothing`,
  );
  await db.query("update public.markets set image_variants = $1", [VARIANTS]);
  await db.query(
    `insert into public.regions (slug, market_slug, name, intro, image_variants)
     values ('test-east-bay', 'california', 'East Bay', 'x', $1)`,
    [VARIANTS],
  );
  await db.query("update public.regions set image_variants = $1", [VARIANTS]);

  const draftId = await completeDraft(db, "test-pr-old-name");
  await db.query("update public.properties set slug = 'test-pr-draft' where id = $1", [draftId]);
  await db.query(TO_STATE, [await insertId(db, DRAFT, ["test-pr-review"]), "review"]);
  await db.query(TO_STATE, [await insertId(db, DRAFT, ["test-pr-agent-review"]), "agent_review"]);
  const archive =
    "update public.properties set editorial_state = 'archived', archived_at = now(), taken_down_at = $2 where id = $1";
  await db.query(archive, [await insertId(db, DRAFT, ["test-pr-archived"]), null]);
  await db.query(archive, [await insertId(db, DRAFT, ["test-pr-taken-down"]), new Date()]);

  const publishedId = await completeDraft(db, "test-pr-published");
  await db.query(TO_STATE, [publishedId, "review"]);
  await db.query(PUBLISH, [publishedId]);
  await db.query(
    `update public.properties set og_image_key = 'test/og.jpg',
       video = '{"src": "test/reel.mp4", "poster": "test/poster.jpg", "caption": "x", "duration": "0:06"}'
     where id = $1`,
    [publishedId],
  );
  await db.query(
    "insert into public.property_media (property_id, staging_path, sort_order) values ($1, $2, 9)",
    [publishedId, `staging/${publishedId}/staged.jpg`],
  );

  for (const editorial of ["draft", "archived", "published"]) {
    await db.query(STORY, [`test-pr-story-${editorial}`, VARIANTS, editorial]);
  }
  await db.query(
    `insert into public.redirects (from_path, to_path, enabled)
     values ('/test-pr-enabled', '/test-pr-to', true), ('/test-pr-disabled', '/test-pr-to', false)`,
  );
  return { draftId };
}

const fixtureSnapshot = () =>
  withRollback(async (db) => {
    await catalogFixture(db);
    return snapshot(db);
  });

const slugs = (rows: Row[]) =>
  rows.map((row) => row["slug"]).filter((slug) => typeof slug === "string");

describe("public_state()", () => {
  it("returns exactly the seven keys, flags and og_static {} when their rows are absent", async () => {
    const read = await withRollback(async (db) => {
      await db.query("delete from public.settings where key in ('flags', 'og_static')");
      return state(db);
    });
    expect({ keys: sortedKeys(read), flags: read.flags, og_static: read.og_static }).toEqual({
      keys: [
        "catalog_version",
        "coming_soon_global",
        "coming_soon_markets",
        "flags",
        "illustrative_content",
        "og_static",
        "site",
      ],
      flags: {},
      og_static: {},
    });
  });

  it("site holds exactly contact, legal and social", async () => {
    const read = await withRollback(async (db) => {
      await setting(db, "site", {
        contact: {
          email: "hello@matterofplace.com",
          phone: null,
          privacy_email: "privacy@matterofplace.com",
        },
        legal: { entity: null, address: null },
        social: { instagram: null, x: null, linkedin: null },
        internal: { note: "staff only" },
      });
      return state(db);
    });
    expect(sortedKeys(read.site)).toEqual(["contact", "legal", "social"]);
  });

  it.each([
    { environment: "development", expected: true },
    { environment: "preview", expected: true },
    { environment: "production", expected: false },
    { environment: "staging", expected: false },
    { environment: null, expected: false },
  ])(
    "illustrative_content is $expected for environment $environment",
    async ({ environment, expected }) => {
      const read = await withRollback(async (db) => {
        await db.query("delete from public.settings where key = 'environment'");
        if (environment !== null) await setting(db, "environment", environment);
        return state(db);
      });
      expect(read.illustrative_content).toBe(expected);
    },
  );
});

describe("public_catalog_snapshot()", () => {
  it("carries only the published property, and gone only the taken-down slug", async () => {
    const read = await fixtureSnapshot();
    expect({ properties: slugs(read.properties), gone: read.gone }).toEqual({
      properties: ["test-pr-published"],
      gone: ["test-pr-taken-down"],
    });
  });

  it("every property, story and media object has exactly its public keys", async () => {
    const read = await fixtureSnapshot();
    const property = read.properties[0];
    expect({
      property: property === undefined ? [] : sortedKeys(property),
      story: read.stories.map(sortedKeys),
      media: property === undefined ? [] : property.media.map(sortedKeys),
    }).toEqual({
      property: [...publicPropertyKeys].sort(),
      story: [[...publicStoryKeys].sort()],
      media: [[...publicMediaKeys].sort()],
    });
  });

  it("the published property carries video, og_image_key and updated_at", async () => {
    const property = (await fixtureSnapshot()).properties[0];
    expect({
      video: property?.["video"],
      og_image_key: property?.["og_image_key"],
      updated_at: typeof property?.["updated_at"],
    }).toEqual({
      video: { src: "test/reel.mp4", poster: "test/poster.jpg", caption: "x", duration: "0:06" },
      og_image_key: "test/og.jpg",
      updated_at: "string",
    });
  });

  it("media holds the stored photograph and not the staged one", async () => {
    const property = (await fixtureSnapshot()).properties[0];
    expect(property?.media.map((media) => media["media_key"])).toEqual(["test/hero.webp"]);
  });

  it("image_variants on the published story and on every market and region", async () => {
    const read = await fixtureSnapshot();
    const variants = [...read.stories, ...read.markets, ...read.regions].map(
      (row) => row["image_variants"],
    );
    const expected: unknown = JSON.parse(VARIANTS);
    expect(variants.length).toBeGreaterThanOrEqual(4);
    expect(variants).toEqual(variants.map(() => expected));
  });

  it("stories: only the published one, with updated_at", async () => {
    const read = await fixtureSnapshot();
    expect(read.stories.map((story) => [story["slug"], typeof story["updated_at"]])).toEqual([
      ["test-pr-story-published", "string"],
    ]);
  });

  it("redirects: only the enabled one; slug_history: the renamed draft's old slug", async () => {
    const read = await fixtureSnapshot();
    expect({
      redirects: read.redirects.map((redirect) => redirect["from_path"]),
      slugHistory: slugs(read.slug_history).filter((slug) => slug.startsWith("test-pr-")),
    }).toEqual({ redirects: ["/test-pr-enabled"], slugHistory: ["test-pr-old-name"] });
  });

  it("one catalog_version in both reads, and publishing the draft raises both by one", async () => {
    const versions = await withRollback(async (db) => {
      const { draftId } = await catalogFixture(db);
      await db.query(TO_STATE, [draftId, "review"]);
      const before = {
        state: (await state(db)).catalog_version,
        snapshot: (await snapshot(db)).catalog_version,
      };
      await db.query(PUBLISH, [draftId]);
      const after = {
        state: (await state(db)).catalog_version,
        snapshot: (await snapshot(db)).catalog_version,
      };
      return {
        equalBefore: before.state === before.snapshot,
        after: after.state - before.state,
        both: after,
      };
    });
    expect({
      equalBefore: versions.equalBefore,
      after: versions.after,
      same: versions.both.state,
    }).toEqual({
      equalBefore: true,
      after: 1,
      same: versions.both.snapshot,
    });
  });
});

describe("the two reads: privileges and shape", () => {
  it("anon and authenticated get permission denied on both, service_role reads both", async () => {
    const outcomes = await withRollback(async (db) => {
      const run = async (role: "anon" | "authenticated" | "service_role", fn: string) => {
        await db.query("savepoint read");
        try {
          await asRole(db, role);
          await db.query(`select public.${fn}()`);
          return "ok";
        } catch (error) {
          if (error instanceof pg.DatabaseError) return `${error.code ?? ""} ${error.message}`;
          throw error;
        } finally {
          await db.query("rollback to savepoint read");
        }
      };
      const result: Record<string, string> = {};
      for (const role of ["anon", "authenticated", "service_role"] as const) {
        for (const fn of ["public_state", "public_catalog_snapshot"])
          result[`${role} ${fn}`] = await run(role, fn);
      }
      return result;
    });
    expect(outcomes).toEqual({
      "anon public_state": "42501 permission denied for function public_state",
      "anon public_catalog_snapshot":
        "42501 permission denied for function public_catalog_snapshot",
      "authenticated public_state": "42501 permission denied for function public_state",
      "authenticated public_catalog_snapshot":
        "42501 permission denied for function public_catalog_snapshot",
      "service_role public_state": "ok",
      "service_role public_catalog_snapshot": "ok",
    });
  });

  it("pg_indexes lists every index the two reads rely on", async () => {
    const expected = [
      "properties_published_at_idx",
      "stories_published_at_idx",
      "redirects_enabled_from_path_idx",
      "properties_market_idx",
      "property_media_idx",
      "property_features_pkey",
      "property_related_pkey",
      "regions_market_idx",
      "market_notes_market_idx",
      "market_guide_entries_market_idx",
      "slug_history_property_idx",
    ];
    const present = await withRollback(async (db) => {
      const read = await db.query<{ indexname: string }>(
        "select indexname from pg_indexes where schemaname = 'public' and indexname = any ($1)",
        [expected],
      );
      return read.rows.map((row) => row.indexname).sort();
    });
    expect(present).toEqual([...expected].sort());
  });

  it("both functions are language sql with one statement", async () => {
    const shapes = await withRollback(async (db) => {
      const read = await db.query<{ name: string; language: string; source: string }>(
        `select p.proname as name, l.lanname as language, p.prosrc as source
         from pg_proc p join pg_language l on l.oid = p.prolang
         where p.pronamespace = 'public'::regnamespace and p.proname in ('public_state', 'public_catalog_snapshot')
         order by p.proname`,
      );
      return read.rows.map(({ name, language, source }) => {
        const statement = source.replace(/--.*$/gm, "").trim().replace(/;$/, "");
        return { name, language, statements: statement.includes(";") ? "several" : "one" };
      });
    });
    expect(shapes).toEqual([
      { name: "public_catalog_snapshot", language: "sql", statements: "one" },
      { name: "public_state", language: "sql", statements: "one" },
    ]);
  });
});
