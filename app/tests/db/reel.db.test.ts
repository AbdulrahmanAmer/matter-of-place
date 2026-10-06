// B12 step 7: an approved reel becomes the dossier's film through the trigger assets_reel_video and attach_reel (Data
// changes, G23, DB-16). Every case runs in a rolled-back transaction through the harness (F22).
import pg from "pg";
import { describe, expect, it } from "vitest";
import { asRole, createStaffUser, withRollback, type Db } from "../fixtures/db";
import { publishedProperty } from "../fixtures/factories";

const VIDEO = "assets/reel-test/reel/r1/reel.aaaaaaaa.mp4";
const POSTER = "assets/reel-test/reel/r1/poster.aaaaaaaa.jpg";
const ALT = "A white house over the bay at dusk.";
const FILES = JSON.stringify([
  { role: "video", media_key: VIDEO, w: 1080, h: 1920, bytes: 9_000_000 },
  { role: "poster", media_key: POSTER, w: 1080, h: 1920, bytes: 200_000 },
]);

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

/** A published Campaign property with a pending reel ready to approve; `files` replaces the two files. */
async function readyReel(db: Db, n: number, files = FILES) {
  const property = await publishedProperty(db, { n, campaign_tier: "Campaign" });
  const asset = await scalar<string>(
    db,
    "select (public.upsert_asset_stub($1, 'reel', 1, null)).id as v",
    [property.id],
  );
  await db.query(
    `update public.assets
     set files = $2::jsonb, caption = 'A house above the water.', alt_text = $3, meta = '{"duration_s": 18}'
     where id = $1`,
    [asset, files, ALT],
  );
  return { property: property.id, asset, approver: await createStaffUser(db, ["media_ops"]) };
}

const approve = "select public.approve_asset($1, $2, 'human', 'req-reel')";
const reject = "select public.reject_asset($1, 'Not this one.', $2, 'human', 'req-reel')";
const video = (db: Db, id: string) =>
  scalar<Record<string, string> | null>(
    db,
    "select video as v from public.properties where id = $1",
    [id],
  );
const catalogVersion = (db: Db) =>
  scalar<number>(
    db,
    "select (value #>> '{}')::int as v from public.settings where key = 'catalog_version'",
  );
const auditRows = (db: Db, action: string, id: string) =>
  db
    .query<{
      actor_id: string | null;
      actor_kind: string | null;
      note: string | null;
      request_id: string | null;
    }>(
      "select actor_id, actor_kind, note, request_id from public.audit_log where action = $1 and entity_id = $2",
      [action, id],
    )
    .then((result) => result.rows);
const SYSTEM_ROW = { actor_id: null, actor_kind: null, note: "system", request_id: null };

describe("assets_reel_video", () => {
  it("approve_asset attaches the film: both keys, the alt text as caption, 0:18 and a system audit row", async () => {
    await withRollback(async (db) => {
      const reel = await readyReel(db, 9701);
      await db.query(approve, [reel.asset, reel.approver]);
      expect(await video(db, reel.property)).toEqual({
        src: VIDEO,
        poster: POSTER,
        caption: ALT,
        duration: "0:18",
      });
      expect(await auditRows(db, "properties.video_attach", reel.property)).toEqual([SYSTEM_ROW]);
      expect(await auditRows(db, "assets.approve", reel.asset)).toMatchObject([
        { actor_id: reel.approver },
      ]);
    });
  });

  it("raises catalog_version by exactly 1 and leaves properties.version unchanged", async () => {
    await withRollback(async (db) => {
      const reel = await readyReel(db, 9702);
      const version = await scalar<number>(
        db,
        "select version as v from public.properties where id = $1",
        [reel.property],
      );
      const catalog = await catalogVersion(db);
      await db.query(approve, [reel.asset, reel.approver]);
      expect(await catalogVersion(db)).toBe(catalog + 1);
      expect(
        await attempt(db, "select public.save_property($1, $2, '{}'::jsonb)", [
          reel.property,
          version,
        ]),
      ).toBe("ok");
    });
  });

  it("public_catalog_snapshot carries the film once it is approved", async () => {
    await withRollback(async (db) => {
      const reel = await readyReel(db, 9703);
      await db.query(approve, [reel.asset, reel.approver]);
      const src = await scalar<string | null>(
        db,
        `select p -> 'video' ->> 'src' as v
         from jsonb_array_elements(public.public_catalog_snapshot() -> 'properties') p
         where p ->> 'id' = $1`,
        [reel.property],
      );
      expect(src).toBe(VIDEO);
    });
  });

  it("reject_asset with a note takes the film down, writes one system detach row and raises catalog_version by 1", async () => {
    await withRollback(async (db) => {
      const reel = await readyReel(db, 9704);
      await db.query(approve, [reel.asset, reel.approver]);
      const catalog = await catalogVersion(db);
      await db.query(reject, [reel.asset, reel.approver]);
      expect(await catalogVersion(db)).toBe(catalog + 1);
      expect(await video(db, reel.property)).toBeNull();
      expect(await auditRows(db, "properties.video_detach", reel.property)).toEqual([SYSTEM_ROW]);
    });
  });

  it("rejecting a reel leaves a film that another asset put there", async () => {
    await withRollback(async (db) => {
      const reel = await readyReel(db, 9705);
      await db.query(approve, [reel.asset, reel.approver]);
      await db.query(
        `update public.properties set video = video || '{"src": "assets/other/reel.bbbbbbbb.mp4"}' where id = $1`,
        [reel.property],
      );
      await db.query(reject, [reel.asset, reel.approver]);
      expect(await video(db, reel.property)).toMatchObject({
        src: "assets/other/reel.bbbbbbbb.mp4",
      });
      expect(await auditRows(db, "properties.video_detach", reel.property)).toEqual([]);
    });
  });

  it("rerender_asset supersedes the approved reel and leaves the film as it is", async () => {
    await withRollback(async (db) => {
      const reel = await readyReel(db, 9706);
      await db.query(approve, [reel.asset, reel.approver]);
      await db.query("select public.rerender_asset($1, $2, 'human', 'req-reel')", [
        reel.asset,
        reel.approver,
      ]);
      expect(
        await scalar<string>(db, "select status as v from public.assets where id = $1", [
          reel.asset,
        ]),
      ).toBe("rejected");
      expect(await video(db, reel.property)).toMatchObject({ src: VIDEO });
    });
  });

  it("a reel without its poster rolls the approval back with reel_files_missing", async () => {
    await withRollback(async (db) => {
      const reel = await readyReel(
        db,
        9707,
        JSON.stringify([{ role: "video", media_key: VIDEO, w: 1080, h: 1920, bytes: 9_000_000 }]),
      );
      expect(await attempt(db, approve, [reel.asset, reel.approver])).toBe(
        "23514 reel_files_missing",
      );
      expect(
        await scalar<string>(db, "select status as v from public.assets where id = $1", [
          reel.asset,
        ]),
      ).toBe("pending");
      expect(await video(db, reel.property)).toBeNull();
    });
  });

  it("anon and authenticated cannot execute attach_reel", async () => {
    await withRollback(async (db) => {
      const reel = await readyReel(db, 9708);
      const call = "select public.attach_reel($1, $2)";
      const outcomes: string[] = [];
      for (const role of ["anon", "authenticated"] as const) {
        await db.query("savepoint as_role");
        await asRole(db, role, role === "authenticated" ? reel.approver : undefined);
        outcomes.push(await attempt(db, call, [reel.property, reel.asset]));
        await db.query("rollback to savepoint as_role");
      }
      expect(outcomes).toEqual([
        "42501 permission denied for function attach_reel",
        "42501 permission denied for function attach_reel",
      ]);
      expect(await video(db, reel.property)).toBeNull();
    });
  });
});
