// B13 step 4: the view `archive_facets` is the database statement of the archive threshold (architecture 13, F25 b).
// Each case inserts its own fixtures inside one rolled-back transaction (F22); none is committed.
import { describe, expect, it } from "vitest";
import { archiveKinds } from "../../src/domain/archive";
import { mapSnapshot, parseSnapshot, toPropertyCard } from "../../src/server/public/mappers";
import { listFacets, MIN_ARCHIVE } from "../../src/server/seo/archive";
import { asRole, withRollback, type Db } from "../fixtures/db";
import { publishedProperty } from "../fixtures/factories";

const CITY = { city: "Fixture Harbor" } as const;

/** Three published properties by one architect in one city, two in one style, and a draft by the same architect. */
async function fixtures(db: Db): Promise<void> {
  for (const n of [9001, 9002, 9003]) {
    await publishedProperty(db, { n, architect: "Fixture Architect", ...CITY });
  }
  for (const n of [9004, 9005]) await publishedProperty(db, { n, style: "Fixture Style" });
  await publishedProperty(db, {
    n: 9006,
    architect: "Fixture Architect",
    editorial_state: "draft",
    published_at: null,
    ...CITY,
  });
}

type ViewRow = { kind: string; slug: string; label: string; property_count: number };

async function viewRows(db: Db): Promise<ViewRow[]> {
  return (
    await db.query<ViewRow>(
      "select kind, slug, label, property_count from public.archive_facets order by kind, slug",
    )
  ).rows;
}

describe("archive_facets", () => {
  it("lists a facet of three published properties, not one of two, and ignores a draft", async () => {
    const rows = await withRollback(async (db) => {
      await fixtures(db);
      return (await viewRows(db)).filter(({ slug }) => slug.startsWith("fixture-"));
    });
    expect(rows).toEqual([
      {
        kind: "architect",
        slug: "fixture-architect",
        label: "Fixture Architect",
        property_count: 3,
      },
      {
        kind: "city",
        slug: "fixture-harbor-ca",
        label: "Fixture Harbor, California",
        property_count: 3,
      },
    ]);
  });

  it("holds the rows that listFacets derives from the snapshot of the same database", async () => {
    const seen = await withRollback(async (db) => {
      await fixtures(db);
      const read = await db.query<{ snapshot: unknown }>(
        "select public.public_catalog_snapshot() as snapshot",
      );
      const snapshot = parseSnapshot(read.rows[0]?.snapshot);
      // The seeded flag is false (B3b's migration), so the state the facets read says true.
      const state = {
        catalogVersion: snapshot.catalog_version,
        flags: { archive_pages: true },
        comingSoonGlobal: false,
        comingSoonMarkets: {},
        site: {},
        illustrativeContent: true,
        ogStatic: {},
      };
      const mapped = mapSnapshot(snapshot, state);
      const catalog = { ...mapped, cards: mapped.properties.map(toPropertyCard) };
      return { derived: listFacets(catalog, state), view: await viewRows(db) };
    });
    const order = (a: { kind: string; slug: string }, b: { kind: string; slug: string }) =>
      archiveKinds.findIndex((kind) => kind === a.kind) -
        archiveKinds.findIndex((kind) => kind === b.kind) || (a.slug < b.slug ? -1 : 1);
    expect(seen.view.length).toBeGreaterThanOrEqual(2);
    expect(
      seen.view
        .map(({ kind, slug, label, property_count }) => ({
          kind,
          slug,
          label,
          count: property_count,
        }))
        .sort(order),
    ).toEqual(seen.derived.map(({ kind, slug, label, count }) => ({ kind, slug, label, count })));
  });

  it("states the threshold that MIN_ARCHIVE holds", async () => {
    const definition = await withRollback(async (db) => {
      const read = await db.query<{ definition: string }>(
        "select pg_get_viewdef('public.archive_facets'::regclass) as definition",
      );
      return read.rows[0]?.definition ?? "";
    });
    expect(definition.match(/>= (\d+)/g)).toEqual([`>= ${String(MIN_ARCHIVE)}`]);
  });

  it("answers the service role and refuses anon and authenticated", async () => {
    const outcomes = await withRollback(async (db) => {
      const results: Record<string, string> = {};
      for (const role of ["service_role", "anon", "authenticated"] as const) {
        await db.query("savepoint probe");
        await asRole(db, role);
        try {
          await db.query("select 1 from public.archive_facets limit 1");
          results[role] = "ok";
        } catch (error) {
          results[role] = error instanceof Error ? error.message : "unknown error";
        }
        await db.query("rollback to savepoint probe");
      }
      return results;
    });
    expect(outcomes).toEqual({
      service_role: "ok",
      anon: "permission denied for view archive_facets",
      authenticated: "permission denied for view archive_facets",
    });
  });
});
