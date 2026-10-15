// W8 item 1: a visual is about a property or about the brand (workspace/05-plans/W8-brand-design.md). The shape rules
// of migration 20261015041030_brand_subject.sql, on assets and social_posts, each case in a rolled-back transaction.
import pg from "pg";
import { describe, expect, it } from "vitest";
import { withRollback, type Db } from "../fixtures/db";

/** Runs `sql` under a savepoint; the refused SQLSTATE, or null when it went through. The transaction stays usable. */
async function refusal(db: Db, sql: string, params: unknown[] = []): Promise<string | null> {
  await db.query("savepoint attempt");
  try {
    await db.query(sql, params);
    await db.query("release savepoint attempt");
    return null;
  } catch (error) {
    await db.query("rollback to savepoint attempt");
    if (error instanceof pg.DatabaseError) return error.code ?? "";
    throw error;
  }
}

const CHECK = "23514";
const UNIQUE = "23505";

describe("a brand visual", () => {
  it("needs a well-formed key and no property, and a listing visual needs its property", async () => {
    await withRollback(async (db) => {
      expect({
        brand: await refusal(
          db,
          "insert into public.assets (subject, brand_key, kind) values ('brand', 'coming-soon', 'cover')",
        ),
        brandWithoutKey: await refusal(
          db,
          "insert into public.assets (subject, kind) values ('brand', 'cover')",
        ),
        brandMalformedKey: await refusal(
          db,
          "insert into public.assets (subject, brand_key, kind) values ('brand', 'Coming Soon!', 'story')",
        ),
        listingWithoutProperty: await refusal(
          db,
          "insert into public.assets (kind) values ('cover')",
        ),
      }).toEqual({
        brand: null,
        brandWithoutKey: CHECK,
        brandMalformedKey: CHECK,
        listingWithoutProperty: CHECK,
      });
    });
  });

  it("is one per key, kind and revision", async () => {
    await withRollback(async (db) => {
      const insert =
        "insert into public.assets (subject, brand_key, kind) values ('brand', 'market-note-california', 'carousel')";
      expect([await refusal(db, insert), await refusal(db, insert)]).toEqual([null, UNIQUE]);
    });
  });

  it("posts with the same shape: a brand post names its key and no property", async () => {
    await withRollback(async (db) => {
      const asset = await db.query<{ id: string }>(
        "insert into public.assets (subject, brand_key, kind) values ('brand', 'coming-soon', 'cover') returning id",
      );
      const assetId = asset.rows[0]?.id ?? "";
      expect({
        brandPost: await refusal(
          db,
          "insert into public.social_posts (asset_id, subject, brand_key, channel, scheduled_at) values ($1, 'brand', 'coming-soon', 'instagram', now())",
          [assetId],
        ),
        brandPostWithoutKey: await refusal(
          db,
          "insert into public.social_posts (asset_id, subject, channel, scheduled_at) values ($1, 'brand', 'instagram', now())",
          [assetId],
        ),
      }).toEqual({ brandPost: null, brandPostWithoutKey: CHECK });
    });
  });
});
