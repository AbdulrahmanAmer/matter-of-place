// W8 item 1: a still post about the brand, a market or a story is a requested visual like a reel (H107).
// record_requested_asset writes it pending; the approve guard holds it to its files, caption and alt text and its
// approval moves no property; staff read it and nobody else does; a rejected one goes with its files after the
// retention period unless a post points at it. Every case runs in a rolled-back transaction through the harness (F22).
import pg from "pg";
import { describe, expect, it } from "vitest";
import { asRole, createStaffUser, withRollback, type Db } from "../fixtures/db";

const SLIDES = JSON.stringify([
  {
    role: "slide",
    index: 0,
    media_key: "requested/p1/slide-0.aaaaaaaa.jpg",
    w: 1080,
    h: 1350,
    bytes: 300_000,
  },
  {
    role: "slide",
    index: 1,
    media_key: "requested/p1/slide-1.bbbbbbbb.jpg",
    w: 1080,
    h: 1350,
    bytes: 300_000,
  },
]);
const COVER = JSON.stringify([
  { role: "main", media_key: "requested/p2/cover.cccccccc.jpg", w: 1200, h: 630, bytes: 200_000 },
]);
const META = JSON.stringify({
  request_id: "00000000-0000-4000-8000-0000000000b1",
  caption_lint: "passed",
});

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

/** A pending brand carousel, as the post pass records it. */
function brandCarousel(db: Db, caption = "Opening soon."): Promise<string> {
  return scalar<string>(
    db,
    `select public.record_requested_asset('brand', 'carousel', $1::jsonb, $2, 'Two lines of type.', $3::jsonb) as v`,
    [SLIDES, caption, META],
  );
}

async function california(db: Db): Promise<void> {
  await db.query(
    `insert into public.markets (slug, name, country, intro) values ('california', 'California', 'United States', 'x')
     on conflict (slug) do nothing`,
  );
}

describe("record_requested_asset", () => {
  it("writes a pending still of its subject with the next revision of its kind and a request_post audit row", async () => {
    await withRollback(async (db) => {
      await california(db);
      const first = await brandCarousel(db);
      const second = await brandCarousel(db);
      const cover = await scalar<string>(
        db,
        `select public.record_requested_asset('brand', 'cover', $1::jsonb, 'Opening soon.', 'A door.', $2::jsonb) as v`,
        [COVER, META],
      );
      const story = await scalar<string>(
        db,
        `select public.record_requested_asset('market', 'story', $1::jsonb, 'Hear first.', 'A coast road.', $2::jsonb,
           p_market => 'california') as v`,
        [COVER, META],
      );
      const rows = await db.query<Record<string, unknown>>(
        `select subject, property_id, market_slug, kind, revision, status from public.assets
         where id = any($1::uuid[]) order by kind, revision`,
        [[first, second, cover, story]],
      );
      expect(rows.rows).toEqual([
        {
          subject: "brand",
          property_id: null,
          market_slug: null,
          kind: "cover",
          revision: 1,
          status: "pending",
        },
        {
          subject: "brand",
          property_id: null,
          market_slug: null,
          kind: "carousel",
          revision: 1,
          status: "pending",
        },
        {
          subject: "brand",
          property_id: null,
          market_slug: null,
          kind: "carousel",
          revision: 2,
          status: "pending",
        },
        {
          subject: "market",
          property_id: null,
          market_slug: "california",
          kind: "story",
          revision: 1,
          status: "pending",
        },
      ]);
      expect(
        await scalar<string[]>(
          db,
          "select array_agg(action order by action) as v from public.audit_log where entity_id = any($1::uuid[])",
          [[first, story]],
        ),
      ).toEqual(["assets.request_post", "assets.request_post"]);
    });
  });

  it("is the one writer of a requested reel too, which keeps its own action and refusal", async () => {
    await withRollback(async (db) => {
      const reel = await scalar<string>(
        db,
        `select public.record_requested_reel('brand', $1::jsonb, 'Not every home.', 'A door.', '{}'::jsonb) as v`,
        [
          JSON.stringify([
            {
              role: "video",
              media_key: "requested/r/reel.aaaaaaaa.mp4",
              w: 1080,
              h: 1920,
              bytes: 1,
            },
          ]),
        ],
      );
      expect({
        kind: await scalar<string>(db, "select kind::text as v from public.assets where id = $1", [
          reel,
        ]),
        action: await scalar<string>(
          db,
          "select action as v from public.audit_log where entity_id = $1",
          [reel],
        ),
        empty: await attempt(
          db,
          "select public.record_requested_reel('brand', '[]'::jsonb, 'c', 'a', '{}'::jsonb)",
        ),
      }).toEqual({
        kind: "reel",
        action: "assets.request_reel",
        empty: "22023 requested_reel_files",
      });
    });
  });

  it("refuses a kind that is not a visual, a visual without files, and a subject without its column", async () => {
    await withRollback(async (db) => {
      expect([
        await attempt(
          db,
          "select public.record_requested_asset('brand', 'newsletter_block', $1::jsonb, 'c', 'a', '{}'::jsonb)",
          [SLIDES],
        ),
        await attempt(
          db,
          "select public.record_requested_asset('brand', 'cover', '[]'::jsonb, 'c', 'a', '{}'::jsonb)",
        ),
        await attempt(
          db,
          "select public.record_requested_asset('market', 'cover', $1::jsonb, 'c', 'a', '{}'::jsonb)",
          [COVER],
        ),
      ]).toEqual([
        "22023 invalid_kind",
        "22023 requested_asset_files",
        expect.stringMatching(/^23514 .*assets_subject_columns/),
      ]);
    });
  });

  it("anon and authenticated cannot execute it", async () => {
    await withRollback(async (db) => {
      const staff = await createStaffUser(db, ["media_ops"]);
      const outcomes: string[] = [];
      for (const role of ["anon", "authenticated"] as const) {
        await db.query("savepoint as_role");
        await asRole(db, role, role === "authenticated" ? staff : undefined);
        outcomes.push(
          await attempt(
            db,
            "select public.record_requested_asset('brand', 'cover', $1::jsonb, 'c', 'a', '{}'::jsonb)",
            [COVER],
          ),
        );
        await db.query("rollback to savepoint as_role");
      }
      expect(outcomes).toEqual([
        "42501 permission denied for function record_requested_asset",
        "42501 permission denied for function record_requested_asset",
      ]);
    });
  });
});

describe("a brand still is approved like any visual", () => {
  it("the approve guard refuses it without a caption, and approves it complete", async () => {
    await withRollback(async (db) => {
      const approver = await createStaffUser(db, ["media_ops"]);
      const bare = await brandCarousel(db, " ");
      const whole = await brandCarousel(db);
      const event = await scalar<string>(
        db,
        "select public.approve_asset($1, $2, 'human', 'req-brand') as v",
        [whole, approver],
      );
      expect({
        bare: await attempt(db, "select public.approve_asset($1, $2, 'human', 'req-bare')", [
          bare,
          approver,
        ]),
        payload: await scalar<Record<string, unknown>>(
          db,
          "select payload as v from public.events where id = $1",
          [event],
        ),
      }).toEqual({
        bare: "23514 asset_incomplete",
        payload: {
          asset_id: whole,
          subject: "brand",
          property_id: null,
          kind: "carousel",
          tier: null,
          market: null,
        },
      });
    });
  });

  it("an approved brand cover moves no property's Open Graph image", async () => {
    await withRollback(async (db) => {
      await california(db);
      const property = await scalar<string>(
        db,
        `insert into public.properties (slug, title, market_slug, city, state, address, type, og_image_key)
         values ('w8-1-probe', 'Test house', 'california', 'Berkeley', 'CA', '1 Test Way', 'Residence', 'og/kept.jpg')
         returning id as v`,
      );
      const approver = await createStaffUser(db, ["chief_editor"]);
      const cover = await scalar<string>(
        db,
        `select public.record_requested_asset('brand', 'cover', $1::jsonb, 'Opening soon.', 'A door.', '{}'::jsonb) as v`,
        [COVER],
      );
      await db.query("select public.approve_asset($1, $2, 'human', 'req-cover')", [
        cover,
        approver,
      ]);
      expect(
        await scalar<string>(db, "select og_image_key as v from public.properties where id = $1", [
          property,
        ]),
      ).toBe("og/kept.jpg");
    });
  });

  it("staff read it, a person without a role and anon do not", async () => {
    await withRollback(async (db) => {
      const asset = await brandCarousel(db);
      const staff = await createStaffUser(db, ["visual_editor"]);
      const nobody = await createStaffUser(db, []);
      const seen: string[] = [];
      for (const [role, user] of [
        ["authenticated", staff],
        ["authenticated", nobody],
        ["anon", undefined],
      ] as const) {
        await db.query("savepoint as_role");
        await asRole(db, role, user);
        await db.query("savepoint read");
        try {
          const { rows } = await db.query("select id from public.assets where id = $1", [asset]);
          seen.push(String(rows.length));
        } catch (error) {
          await db.query("rollback to savepoint read");
          seen.push(error instanceof pg.DatabaseError ? (error.code ?? "") : "error");
        }
        await db.query("rollback to savepoint as_role");
      }
      expect(seen).toEqual(["1", "0", "42501"]);
    });
  });
});

describe("the retention of rejected requested visuals", () => {
  it("lists a rejected one past its period with its requested/ files, never a pending, recent, property or posted one, and deletes only those", async () => {
    await withRollback(async (db) => {
      const person = await createStaffUser(db, ["media_ops"]);
      const old = await brandCarousel(db);
      const recent = await brandCarousel(db);
      const pending = await brandCarousel(db);
      const posted = await brandCarousel(db);
      for (const id of [old, recent, posted]) {
        await db.query(
          "select public.reject_asset($1, 'Not this one.', $2, 'human', 'req-reject')",
          [id, person],
        );
      }
      await db.query(
        `insert into public.social_posts (asset_id, property_id, channel, status, scheduled_at, error)
         values ($1, null, 'instagram', 'failed', now(), 'cancelled')`,
        [posted],
      );
      // set_updated_at stamps every update with now(), so the age is written with it off (rolled back with the case)
      await db.query("alter table public.assets disable trigger assets_set_updated_at");
      await db.query(
        "update public.assets set updated_at = now() - interval '100 days' where id = any($1::uuid[])",
        [[old, pending, posted]],
      );
      // a file outside requested/ is never the retention's to remove
      await db.query(
        `update public.assets set files = files || '[{"role":"slide","index":2,"media_key":"proposed/b/kept.cccccccc.jpg","w":1080,"h":1350,"bytes":1}]'::jsonb
         where id = $1`,
        [old],
      );
      await db.query("alter table public.assets enable trigger assets_set_updated_at");
      const listed = await db.query<{ asset_id: string; media_keys: string[] }>(
        "select asset_id, media_keys from public.retention_requested_visuals(interval '90 days')",
      );
      expect(listed.rows).toEqual([
        {
          asset_id: old,
          media_keys: ["requested/p1/slide-0.aaaaaaaa.jpg", "requested/p1/slide-1.bbbbbbbb.jpg"],
        },
      ]);
      expect(
        await scalar<number>(db, "select public.retention_delete_assets($1::uuid[]) as v", [
          [old, recent, pending, posted],
        ]),
      ).toBe(1);
      expect(
        await scalar<string[]>(
          db,
          "select array_agg(id order by id) as v from public.assets where id = any($1::uuid[])",
          [[old, recent, pending, posted]],
        ),
      ).toEqual([recent, pending, posted].sort());
    });
  });

  it("is a policy row of 90 days, and anon and authenticated cannot run either function", async () => {
    await withRollback(async (db) => {
      expect(
        (
          await db.query(
            "select keep_for::text, action, enabled from public.retention_policies where key = 'rejected_requested_visuals'",
          )
        ).rows,
      ).toEqual([{ keep_for: "90 days", action: "delete", enabled: true }]);
      const staff = await createStaffUser(db, ["admin"]);
      const outcomes: string[] = [];
      for (const role of ["anon", "authenticated"] as const) {
        await db.query("savepoint as_role");
        await asRole(db, role, role === "authenticated" ? staff : undefined);
        outcomes.push(
          await attempt(db, "select * from public.retention_requested_visuals(interval '0 days')"),
        );
        outcomes.push(await attempt(db, "select public.retention_delete_assets('{}'::uuid[])"));
        await db.query("rollback to savepoint as_role");
      }
      expect(outcomes).toEqual([
        "42501 permission denied for function retention_requested_visuals",
        "42501 permission denied for function retention_delete_assets",
        "42501 permission denied for function retention_requested_visuals",
        "42501 permission denied for function retention_delete_assets",
      ]);
    });
  });
});
