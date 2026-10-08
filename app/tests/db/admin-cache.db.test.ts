// B7 invariant 17 (the caching contract, admin side): every admin list filters and sorts on an index its own migration
// creates, and a write bumps `catalog_version` through B2's triggers exactly when the public catalog changes (F25 a).
// Later steps add the one-call dashboard here.
import { describe, expect, it } from "vitest";
import { createStaffUser, withRollback, type Db } from "../fixtures/db";
import { publishedProperty } from "../fixtures/factories";

async function indexDefinitions(db: Db, table: string, names: string[]): Promise<string[]> {
  return (
    await db.query<{ indexdef: string }>(
      `select indexdef from pg_indexes
       where schemaname = 'public' and tablename = $1 and indexname = any ($2::text[]) order by indexname`,
      [table, names],
    )
  ).rows.map((row) => row.indexdef);
}

async function catalogVersion(db: Db): Promise<number> {
  const { rows } = await db.query<{ version: string }>(
    "select value #>> '{}' as version from public.settings where key = 'catalog_version'",
  );
  return Number(rows[0]?.version);
}

/** The case runs only against a database that holds step 7's migration (P-328). */
async function assertStep7(db: Db): Promise<void> {
  const { rows } = await db.query<{ present: boolean }>(
    "select to_regproc('public.publish_property') is not null as present",
  );
  expect(rows[0]?.present).toBe(true);
}

/** The case runs only against a database that holds step 8's migration (P-328). */
async function assertStep8(db: Db): Promise<void> {
  const { rows } = await db.query<{ present: boolean }>(
    "select to_regproc('public.reorder_media') is not null and to_regproc('public.set_media_alt') is not null as present",
  );
  expect(rows[0]?.present).toBe(true);
}

/** The case runs only against a database that holds step 7a's migration (P-328). */
async function assertStep7a(db: Db): Promise<void> {
  const { rows } = await db.query<{ present: boolean }>(
    "select to_regproc('public.unpublish_property') is not null as present",
  );
  expect(rows[0]?.present).toBe(true);
}

async function versionOf(db: Db, id: string): Promise<number> {
  const { rows } = await db.query<{ version: number }>(
    "select version from public.properties where id = $1",
    [id],
  );
  return rows[0]?.version ?? 0;
}

/** A property ready to publish: every field filled (the factory), in review, with six photographs with alt text. */
async function inReview(db: Db, n: number): Promise<string> {
  const { id } = await publishedProperty(db, { n, editorial_state: "review", published_at: null });
  for (let order = 1; order <= 6; order += 1) {
    await db.query(
      `insert into public.property_media (property_id, media_key, alt, orientation, sort_order)
       values ($1, 'o/fixture/' || $2::int || '-0a1b2c3d.webp', 'Room', 'landscape', $2::int)`,
      [id, order],
    );
  }
  return id;
}

describe("admin list indexes", () => {
  it("the submissions list index leads with the state and pages by received_at desc, id", async () => {
    const definitions = await withRollback((db) =>
      indexDefinitions(db, "submissions", ["submissions_list_idx"]),
    );
    expect(definitions).toEqual([
      "CREATE INDEX submissions_list_idx ON public.submissions USING btree (workflow_state, received_at DESC, id)",
    ]);
  });

  it("the properties list pages by state, updated_at desc, id and the representatives by name", async () => {
    const definitions = await withRollback(async (db) => [
      ...(await indexDefinitions(db, "properties", ["properties_list_idx"])),
      ...(await indexDefinitions(db, "representatives", ["representatives_name_idx"])),
    ]);
    expect(definitions).toEqual([
      "CREATE INDEX properties_list_idx ON public.properties USING btree (editorial_state, updated_at DESC, id)",
      "CREATE INDEX representatives_name_idx ON public.representatives USING btree (lower(name), id)",
    ]);
  });
});

describe("catalog_version and the property writes (F25 a)", () => {
  it("publish_property raises it by exactly one", async () => {
    await withRollback(async (db) => {
      await assertStep7(db);
      const editor = await createStaffUser(db, ["chief_editor"]);
      const id = await inReview(db, 9950);
      const before = await catalogVersion(db);
      await db.query("select public.publish_property($1, $2, $3, 'human', 'req-cv')", [
        id,
        await versionOf(db, id),
        editor,
      ]);
      expect((await catalogVersion(db)) - before).toBe(1);
    });
  });

  it("an edit of a published row raises it by exactly one, and an edit of a draft leaves it", async () => {
    await withRollback(async (db) => {
      await assertStep7(db);
      const editor = await createStaffUser(db, ["managing_editor"]);
      const published = await publishedProperty(db, { n: 9951 });
      const { id: draft } = await publishedProperty(db, {
        n: 9952,
        editorial_state: "draft",
        published_at: null,
      });
      const edit = async (id: string) => {
        const before = await catalogVersion(db);
        await db.query(
          `select public.update_property($1, $2, '{"title": "Edited"}', $3, 'human', 'req-cv')`,
          [id, await versionOf(db, id), editor],
        );
        return (await catalogVersion(db)) - before;
      };
      expect({ published: await edit(published.id), draft: await edit(draft) }).toEqual({
        published: 1,
        draft: 0,
      });
    });
  });

  it("an unpublish raises it by exactly one, and a takedown unpublish by exactly one", async () => {
    await withRollback(async (db) => {
      await assertStep7a(db);
      const editor = await createStaffUser(db, ["chief_editor"]);
      const unpublish = async (n: number, takedown: boolean) => {
        const { id } = await publishedProperty(db, { n });
        const before = await catalogVersion(db);
        await db.query(
          "select public.unpublish_property($1, 'owner_request', $2, $3, 'human', 'req-cv')",
          [id, takedown, editor],
        );
        return (await catalogVersion(db)) - before;
      };
      expect({
        unpublish: await unpublish(9953, false),
        takedown: await unpublish(9954, true),
      }).toEqual({
        unpublish: 1,
        takedown: 1,
      });
    });
  });

  it("a media reorder raises it by exactly one, and an alt edit by exactly one (B2's property_media trigger)", async () => {
    await withRollback(async (db) => {
      await assertStep8(db);
      const editor = await createStaffUser(db, ["visual_editor"]);
      const id = await inReview(db, 9996);
      const { rows } = await db.query<{ id: string }>(
        "select id from public.property_media where property_id = $1 order by sort_order",
        [id],
      );
      const order = rows.map((row) => row.id);
      const bumpOf = async (sql: string, params: unknown[]) => {
        const before = await catalogVersion(db);
        await db.query(sql, params);
        return (await catalogVersion(db)) - before;
      };
      expect({
        reorder: await bumpOf(
          "select public.reorder_media($1, $2::uuid[], $3, 'human', 'req-cv')",
          [id, [...order.slice(0, 4), order[5], order[4]], editor],
        ),
        alt: await bumpOf("select public.set_media_alt($1, 'The terrace', $2, 'human', 'req-cv')", [
          order[0],
          editor,
        ]),
      }).toEqual({ reorder: 1, alt: 1 });
    });
  });
});
