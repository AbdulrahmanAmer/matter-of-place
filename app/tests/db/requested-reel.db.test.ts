// W7 item 19, slice E1 (ruling H107): a reel a colleague or Matter asks for may be about a market, a story or the
// brand. record_requested_reel writes it pending; approval works as for any reel, with no dossier to go on; re-render is
// refused. Every case runs in a rolled-back transaction through the harness (F22).
import pg from "pg";
import { describe, expect, it } from "vitest";
import { asRole, createStaffUser, withRollback, type Db } from "../fixtures/db";

const FILES = JSON.stringify([
  {
    role: "video",
    media_key: "requested/r1/reel.aaaaaaaa.mp4",
    w: 1080,
    h: 1920,
    bytes: 9_000_000,
  },
  {
    role: "poster",
    media_key: "requested/r1/poster.aaaaaaaa.jpg",
    w: 1080,
    h: 1920,
    bytes: 200_000,
  },
]);
const META = JSON.stringify({ request: { kind: "market", market: "california" }, duration_s: 20 });

async function scalar<T>(db: Db, sql: string, params: unknown[] = []): Promise<T> {
  const row = (await db.query<{ v: T }>(sql, params)).rows[0];
  if (row === undefined) throw new Error(`no row from: ${sql}`);
  return row.v;
}

/** Runs `sql` under a savepoint and returns `ok` or `<SQLSTATE> <message>`; the transaction stays usable (G-102). */
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

/** A pending reel about California, as the runner records it. */
async function marketReel(db: Db): Promise<string> {
  await db.query(
    `insert into public.markets (slug, name, country, intro) values ('california', 'California', 'United States', 'x')
     on conflict (slug) do nothing`,
  );
  return scalar<string>(
    db,
    `select public.record_requested_reel('market', $1::jsonb, 'California, house by house.', 'A coast road at dusk.',
       $2::jsonb, p_market => 'california') as v`,
    [FILES, META],
  );
}

describe("record_requested_reel", () => {
  it("writes a pending reel of its subject with the next revision and a system audit row", async () => {
    await withRollback(async (db) => {
      const first = await marketReel(db);
      const second = await marketReel(db);
      const rows = await db.query<Record<string, unknown>>(
        `select subject, property_id, market_slug, story_id, kind, revision, status, meta -> 'request' as request
         from public.assets where id = any($1::uuid[]) order by revision`,
        [[first, second]],
      );
      expect(rows.rows).toEqual([
        {
          subject: "market",
          property_id: null,
          market_slug: "california",
          story_id: null,
          kind: "reel",
          revision: 1,
          status: "pending",
          request: { kind: "market", market: "california" },
        },
        expect.objectContaining({ revision: 2, status: "pending" }),
      ]);
      expect(
        await scalar<number>(
          db,
          "select count(*)::int as v from public.audit_log where action = 'assets.request_reel' and entity_id = $1",
          [first],
        ),
      ).toBe(1);
    });
  });

  it("refuses a subject without its column, or with a property's", async () => {
    await withRollback(async (db) => {
      const property = "00000000-0000-4000-8000-00000000e101";
      expect([
        await attempt(
          db,
          "select public.record_requested_reel('market', $1::jsonb, 'c', 'a', '{}'::jsonb)",
          [FILES],
        ),
        await attempt(
          db,
          "select public.record_requested_reel('brand', $1::jsonb, 'c', 'a', '{}'::jsonb, p_market => 'california')",
          [FILES],
        ),
        await attempt(
          db,
          "insert into public.assets (subject, property_id, kind, revision) values ('market', $1, 'reel', 1)",
          [property],
        ),
        await attempt(
          db,
          "select public.record_requested_reel('brand', '[]'::jsonb, 'c', 'a', '{}'::jsonb)",
        ),
      ]).toEqual([
        expect.stringMatching(/^23514 .*assets_subject_columns/),
        expect.stringMatching(/^23514 .*assets_subject_columns/),
        expect.stringMatching(/^23514 .*assets_subject_columns/),
        "22023 requested_reel_files",
      ]);
    });
  });

  it("approve_asset approves it and emits asset.approved with its subject and market, no property", async () => {
    await withRollback(async (db) => {
      const asset = await marketReel(db);
      const approver = await createStaffUser(db, ["media_ops"]);
      const event = await scalar<string>(
        db,
        "select public.approve_asset($1, $2, 'human', 'req-requested') as v",
        [asset, approver],
      );
      expect({
        status: await scalar<string>(db, "select status as v from public.assets where id = $1", [
          asset,
        ]),
        payload: await scalar<Record<string, unknown>>(
          db,
          "select payload as v from public.events where id = $1",
          [event],
        ),
      }).toEqual({
        status: "approved",
        payload: {
          asset_id: asset,
          subject: "market",
          property_id: null,
          kind: "reel",
          tier: null,
          market: "california",
        },
      });
    });
  });

  it("refuses to re-render it: a new request is the path", async () => {
    await withRollback(async (db) => {
      const asset = await marketReel(db);
      const approver = await createStaffUser(db, ["media_ops"]);
      expect(
        await attempt(db, "select public.rerender_asset($1, $2, 'human', 'req-requested')", [
          asset,
          approver,
        ]),
      ).toBe("22023 requested_asset");
    });
  });

  it("anon and authenticated cannot execute it", async () => {
    await withRollback(async (db) => {
      const call = "select public.record_requested_reel('brand', $1::jsonb, 'c', 'a', '{}'::jsonb)";
      const staff = await createStaffUser(db, ["media_ops"]);
      const outcomes: string[] = [];
      for (const role of ["anon", "authenticated"] as const) {
        await db.query("savepoint as_role");
        await asRole(db, role, role === "authenticated" ? staff : undefined);
        outcomes.push(await attempt(db, call, [FILES]));
        await db.query("rollback to savepoint as_role");
      }
      expect(outcomes).toEqual([
        "42501 permission denied for function record_requested_reel",
        "42501 permission denied for function record_requested_reel",
      ]);
    });
  });
});
