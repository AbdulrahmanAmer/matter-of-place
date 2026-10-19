// W8 item 10 (rulings H116, H134): proposed posts. create_proposed_post refuses a disabled channel, a file not in
// storage, a caption over the channel's limit and a LinkedIn reel without its poster; approve_proposed_post is a
// person's only, once, for the revision they saw, and turns each channel into an approved asset and the social_posts
// row the posting path reads; reject and re-render keep the revision's snapshot and tell the proposer; a scheduled post
// is posted once every row is. Every case runs in a rolled-back transaction through the harness (F22).
import pg from "pg";
import { describe, expect, it } from "vitest";
import { createAuthUser, createStaffUser, withRollback, type Db } from "../fixtures/db";
import { publishedProperty } from "../fixtures/factories";

async function scalar<T>(db: Db, sql: string, params: unknown[] = []): Promise<T> {
  const row = (await db.query<{ v: T }>(sql, params)).rows[0];
  if (row === undefined) throw new Error(`no row from: ${sql}`);
  return row.v;
}

/** Runs `sql` under a savepoint and returns `ok` or `<message>: <detail>`; the transaction stays usable (G-102). */
async function attempt(db: Db, sql: string, params: unknown[] = []): Promise<string> {
  await db.query("savepoint attempt");
  try {
    await db.query(sql, params);
    await db.query("release savepoint attempt");
    return "ok";
  } catch (error) {
    await db.query("rollback to savepoint attempt");
    if (error instanceof pg.DatabaseError) return `${error.message}: ${error.detail ?? ""}`;
    throw error;
  }
}

const file = (key: string, alt = "The entrance hall in morning light.") => ({
  key,
  source: "studio",
  original: `C:/studio/${key}`,
  alt,
  w: 1080,
  h: 1350,
  bytes: 200_000,
});

/** The Fairfield set's shape (item 11): an Instagram carousel, LinkedIn squares and an X cover. */
const FAIRFIELD = [
  {
    channel: "instagram",
    format: "carousel",
    caption: "Fairfield, three rooms in October light.",
    images: [file("proposed/t/s1.jpg"), file("proposed/t/s2.jpg"), file("proposed/t/s3.jpg")],
    reel: null,
  },
  {
    channel: "linkedin",
    format: "carousel",
    caption: "A house in Fairfield, read room by room.",
    images: [file("proposed/t/q1.jpg"), file("proposed/t/q2.jpg")],
    reel: null,
  },
  {
    channel: "x",
    format: "single",
    caption: "Fairfield, in three rooms.",
    images: [file("proposed/t/x.jpg")],
    reel: null,
  },
];

const KEYS = ["s1", "s2", "s3", "q1", "q2", "x", "reel", "poster"].map((name) =>
  name === "reel" ? "proposed/t/reel.mp4" : `proposed/t/${name}.jpg`,
);

/** The files are in the public media bucket, as the runner leaves them before it proposes. */
async function stored(db: Db): Promise<void> {
  await db.query(
    "insert into storage.objects (bucket_id, name) select 'media', unnest($1::text[]) on conflict do nothing",
    [KEYS],
  );
}

/** A colleague's proposal through the runner: no actor, the colleague's slug. */
async function propose(db: Db, channels: unknown, test = true): Promise<string> {
  return scalar<string>(
    db,
    `select public.create_proposed_post('Fairfield', $1::jsonb, 'agent', p_proposer_agent => 'chief', p_test => $2) as v`,
    [JSON.stringify(channels), test],
  );
}

/** Matter's account: the admin role held as an agent (scripts/matter/key.ts). */
async function matterAccount(db: Db): Promise<string> {
  const id = await createAuthUser(db);
  await db.query(
    "insert into public.user_roles (user_id, role, actor_kind) values ($1, 'admin', 'agent')",
    [id],
  );
  return id;
}

describe("create_proposed_post", () => {
  it("files a colleague's post with one row per channel of revision 1 and a system audit row naming it", async () => {
    await withRollback(async (db) => {
      await stored(db);
      const id = await propose(db, FAIRFIELD);
      const post = await db.query<Record<string, unknown>>(
        "select status, revision, test, proposer_kind, proposer_agent, property_id from public.proposed_posts where id = $1",
        [id],
      );
      expect(post.rows).toEqual([
        {
          status: "proposed",
          revision: 1,
          test: true,
          proposer_kind: "agent",
          proposer_agent: "chief",
          property_id: null,
        },
      ]);
      const channels = await db.query<Record<string, unknown>>(
        `select channel, format, jsonb_array_length(media -> 'images') as images from public.proposed_post_channels
         where post_id = $1 and revision = 1 order by channel`,
        [id],
      );
      expect(channels.rows).toEqual([
        { channel: "instagram", format: "carousel", images: 3 },
        { channel: "linkedin", format: "carousel", images: 2 },
        { channel: "x", format: "single", images: 1 },
      ]);
      const audit = await db.query<Record<string, unknown>>(
        "select actor_id, action, note from public.audit_log where entity_id = $1",
        [id],
      );
      expect(audit.rows).toEqual([
        { actor_id: null, action: "channels.proposed_create", note: "agent:chief" },
      ]);
    });
  });

  it("refuses a disabled channel, a file not in storage, a long caption and a LinkedIn reel without its poster", async () => {
    await withRollback(async (db) => {
      await stored(db);
      const one = (channel: Record<string, unknown>) =>
        attempt(
          db,
          `select public.create_proposed_post('Fairfield', $1::jsonb, 'agent', p_proposer_agent => 'chief')`,
          [JSON.stringify([channel])],
        );
      const x = {
        channel: "x",
        format: "single",
        caption: "Fairfield.",
        images: [file("proposed/t/x.jpg")],
        reel: null,
      };
      const reel = {
        channel: "linkedin",
        format: "reel",
        caption: "Fairfield.",
        images: [],
        reel: { video: file("proposed/t/reel.mp4"), poster: null },
      };
      expect({
        facebook: await one({ ...x, channel: "facebook" }),
        missing: await one({ ...x, images: [file("proposed/t/nowhere.jpg")] }),
        long: await one({ ...x, caption: "a".repeat(281) }),
        atLimit: await one({ ...x, caption: "a".repeat(280) }),
        poster: await one(reel),
        withPoster: await one({
          ...reel,
          reel: { video: file("proposed/t/reel.mp4"), poster: file("proposed/t/poster.jpg") },
        }),
      }).toEqual({
        facebook: "channel_disabled: Facebook is a disabled channel block.",
        missing:
          "media_not_found: proposed/t/nowhere.jpg is not in storage: the studio or Drive file is uploaded before it is proposed.",
        long: "caption_too_long: X captions are at most 280 characters; this one has 281.",
        atLimit: "ok",
        poster: "reel_poster_required: A reel on LinkedIn needs its poster.",
        withPoster: "ok",
      });
    });
  });
});

describe("approve_proposed_post", () => {
  it("turns each channel into an approved brand asset and the scheduled social_posts row the posting path reads", async () => {
    await withRollback(async (db) => {
      await stored(db);
      const id = await propose(db, FAIRFIELD, false);
      const person = await createStaffUser(db, ["chief_editor"]);
      const answer = await scalar<{ event_ids: string[]; social_post_ids: string[] }>(
        db,
        "select public.approve_proposed_post($1, 1, $2, 'human') as v",
        [id, person],
      );
      expect([answer.event_ids.length, answer.social_post_ids.length]).toEqual([3, 3]);
      const rows = await db.query<Record<string, unknown>>(
        `select s.channel, s.status, s.property_id, a.subject, a.kind, a.status as asset_status,
           a.approved_by = $2 as by_person, a.files -> 0 ->> 'role' as role, a.meta -> 'proposed_post' ->> 'test' as test,
           s.id = c.social_post_id as linked
         from public.proposed_post_channels c
         join public.assets a on a.id = c.asset_id
         join public.social_posts s on s.asset_id = a.id and s.channel = c.channel
         where c.post_id = $1 order by s.channel`,
        [id, person],
      );
      const row = {
        status: "scheduled",
        property_id: null,
        subject: "brand",
        asset_status: "approved",
        by_person: true,
      };
      expect(rows.rows).toEqual([
        {
          ...row,
          channel: "instagram",
          kind: "carousel",
          role: "slide",
          test: "false",
          linked: true,
        },
        {
          ...row,
          channel: "linkedin",
          kind: "carousel",
          role: "linkedin_set",
          test: "false",
          linked: true,
        },
        { ...row, channel: "x", kind: "cover", role: "x", test: "false", linked: true },
      ]);
      // The posting path calls schedule_social_post for its asset and channel: it reads the same row, never a second.
      const again = await scalar<string>(
        db,
        `select (public.schedule_social_post(c.asset_id, c.channel, now())).id as v
         from public.proposed_post_channels c where c.post_id = $1 and c.channel = 'x'`,
        [id],
      );
      expect(answer.social_post_ids).toContain(again);
      const events = await scalar<number>(
        db,
        "select count(*)::int as v from public.events where id = any($1::uuid[]) and type = 'asset.approved'",
        [answer.event_ids],
      );
      expect(events).toBe(3);
      expect(
        await scalar<string>(
          db,
          "select status::text as v from public.proposed_posts where id = $1",
          [id],
        ),
      ).toBe("scheduled");
    });
  });

  it("is refused for an agent, for Matter's key, for a stale revision, a second time and after a rejection", async () => {
    await withRollback(async (db) => {
      await stored(db);
      const id = await propose(db, FAIRFIELD);
      const rejected = await propose(db, FAIRFIELD);
      const person = await createStaffUser(db, ["chief_editor"]);
      const matter = await matterAccount(db);
      await db.query(
        "select public.reject_proposed_post($1, 'Warmer light.', false, $2, 'human')",
        [rejected, person],
      );
      const approve = (post: string, revision: number, actor: string | null, kind: string) =>
        attempt(db, "select public.approve_proposed_post($1, $2, $3, $4::public.actor_kind)", [
          post,
          revision,
          actor,
          kind,
        ]);
      expect({
        matter: await approve(id, 1, matter, "agent"),
        system: await approve(id, 1, null, "human"),
        stale: await approve(id, 2, person, "human"),
        first: await approve(id, 1, person, "human"),
        twice: await approve(id, 1, person, "human"),
        rejected: await approve(rejected, 1, person, "human"),
      }).toEqual({
        matter: "manual_approval: A person approves a post.",
        system: "manual_approval: A person approves a post.",
        stale: "version_conflict: This post changed since it was opened.",
        first: "ok",
        twice: "wrong_state: Only a proposed post can be approved.",
        rejected: "wrong_state: Only a proposed post can be approved.",
      });
    });
  });

  it("records a property's Instagram single as a cover slide and leaves the property's share image alone", async () => {
    await withRollback(async (db) => {
      await stored(db);
      const property = await publishedProperty(db, { n: 9811 });
      await db.query("reset role");
      await db.query("update public.properties set og_image_key = 'og/before.jpg' where id = $1", [
        property.id,
      ]);
      const id = await scalar<string>(
        db,
        `select public.create_proposed_post('Fairfield', $1::jsonb, 'agent', p_proposer_agent => 'chief',
           p_property => $2) as v`,
        [
          JSON.stringify([
            {
              channel: "instagram",
              format: "single",
              caption: "Fairfield.",
              images: [file("proposed/t/s1.jpg")],
              reel: null,
            },
          ]),
          property.id,
        ],
      );
      const person = await createStaffUser(db, ["chief_editor"]);
      await db.query("select public.approve_proposed_post($1, 1, $2, 'human')", [id, person]);
      const row = await db.query<Record<string, unknown>>(
        `select a.subject, a.kind, a.files -> 0 ->> 'role' as role, a.files -> 0 ->> 'index' as index,
           s.property_id = $2 as same_property, p.og_image_key
         from public.proposed_post_channels c
         join public.assets a on a.id = c.asset_id
         join public.social_posts s on s.id = c.social_post_id
         join public.properties p on p.id = a.property_id
         where c.post_id = $1`,
        [id, property.id],
      );
      expect(row.rows).toEqual([
        {
          subject: "property",
          kind: "cover",
          role: "slide",
          index: "0",
          same_property: true,
          og_image_key: "og/before.jpg",
        },
      ]);
    });
  });

  it("marks a scheduled post posted only once every channel row is posted", async () => {
    await withRollback(async (db) => {
      await stored(db);
      const id = await propose(db, FAIRFIELD, false);
      const person = await createStaffUser(db, ["chief_editor"]);
      await db.query("select public.approve_proposed_post($1, 1, $2, 'human')", [id, person]);
      const status = () =>
        scalar<string>(db, "select status::text as v from public.proposed_posts where id = $1", [
          id,
        ]);
      const post = (channel: string) =>
        db.query(
          `update public.social_posts set status = 'posted', posted_at = now()
           where id = (select social_post_id from public.proposed_post_channels where post_id = $1 and channel = $2)`,
          [id, channel],
        );
      await post("instagram");
      await post("x");
      const partly = await status();
      await post("linkedin");
      expect([partly, await status()]).toEqual(["scheduled", "posted"]);
    });
  });

  it("closes a test post's rows as cancelled at approval and leaves the post approved", async () => {
    await withRollback(async (db) => {
      await stored(db);
      const id = await propose(db, FAIRFIELD, true);
      const person = await createStaffUser(db, ["media_ops"]);
      await db.query("select public.approve_proposed_post($1, 1, $2, 'human')", [id, person]);
      const rows = await db.query<Record<string, unknown>>(
        `select s.status, s.error from public.proposed_post_channels c
         join public.social_posts s on s.id = c.social_post_id where c.post_id = $1 order by c.channel`,
        [id],
      );
      const cancelled = { status: "failed", error: "cancelled" };
      expect({
        rows: rows.rows,
        post: await scalar<string>(
          db,
          "select status::text as v from public.proposed_posts where id = $1",
          [id],
        ),
      }).toEqual({ rows: [cancelled, cancelled, cancelled], post: "approved" });
    });
  });

  it("settles a post whose skipped channels the step cancelled: posted when one posted, approved when none", async () => {
    await withRollback(async (db) => {
      await stored(db);
      const some = await propose(db, FAIRFIELD, false);
      const none = await propose(db, FAIRFIELD, false);
      const person = await createStaffUser(db, ["chief_editor"]);
      for (const id of [some, none]) {
        await db.query("select public.approve_proposed_post($1, 1, $2, 'human')", [id, person]);
      }
      const rowOf = `(select social_post_id from public.proposed_post_channels where post_id = $1 and channel = $2)`;
      const cancel = (id: string, channel: string) =>
        db.query(`select public.fail_social_post(${rowOf}, 'cancelled')`, [id, channel]);
      const status = (id: string) =>
        scalar<string>(db, "select status::text as v from public.proposed_posts where id = $1", [
          id,
        ]);
      await db.query(
        `update public.social_posts set status = 'posted', posted_at = now() where id = ${rowOf}`,
        [some, "instagram"],
      );
      await cancel(some, "linkedin");
      const waiting = await status(some);
      await cancel(some, "x");
      for (const channel of ["instagram", "linkedin", "x"]) await cancel(none, channel);
      expect([waiting, await status(some), await status(none)]).toEqual([
        "scheduled",
        "posted",
        "approved",
      ]);
    });
  });
});

describe("reject_proposed_post and revise_proposed_post", () => {
  it("lets Matter send a post back with its snapshot, tells the proposer, and takes the next revision", async () => {
    await withRollback(async (db) => {
      await stored(db);
      const id = await propose(db, FAIRFIELD);
      const matter = await matterAccount(db);
      await db.query(
        "select public.reject_proposed_post($1, 'The X cover is too dark.', false, $2, 'agent')",
        [id, matter],
      );
      const revision = await db.query<Record<string, unknown>>(
        `select revision, reason, note, asked_by = $2 as by_matter, asked_by_kind,
           jsonb_array_length(snapshot -> 'channels') as channels
         from public.proposed_post_revisions where post_id = $1`,
        [id, matter],
      );
      expect(revision.rows).toEqual([
        {
          revision: 1,
          reason: "rejected",
          note: "The X cover is too dark.",
          by_matter: true,
          asked_by_kind: "agent",
          channels: 3,
        },
      ]);
      const audit = await db.query<Record<string, unknown>>(
        "select action, note from public.audit_log where entity_id = $1 and actor_id = $2",
        [id, matter],
      );
      expect(audit.rows).toEqual([{ action: "channels.proposed_reject", note: "agent:matter" }]);
      const told = await scalar<number>(
        db,
        `select count(*)::int as v from public.agent_messages
         where thread = 'chief' and body = 'Sent back: "Fairfield" (revision 1): The X cover is too dark.'`,
      );
      expect(told).toBe(1);

      const next = await scalar<number>(
        db,
        "select public.revise_proposed_post($1, $2::jsonb, p_proposer_agent => 'chief') as v",
        [id, JSON.stringify(FAIRFIELD.slice(2))],
      );
      const rows = await db.query<Record<string, unknown>>(
        "select revision, count(*)::int as channels from public.proposed_post_channels where post_id = $1 group by revision order by revision",
        [id],
      );
      expect({
        next,
        status: await scalar<string>(
          db,
          "select status::text as v from public.proposed_posts where id = $1",
          [id],
        ),
        rows: rows.rows,
      }).toEqual({
        next: 2,
        status: "proposed",
        rows: [
          { revision: 1, channels: 3 },
          { revision: 2, channels: 1 },
        ],
      });
    });
  });

  it("asks for a re-render under its own audit action, needs a note, and refuses a decided post", async () => {
    await withRollback(async (db) => {
      await stored(db);
      const id = await propose(db, FAIRFIELD);
      const person = await createStaffUser(db, ["chief_editor"]);
      const send = (note: string, rerender: boolean) =>
        attempt(db, "select public.reject_proposed_post($1, $2, $3, $4, 'human')", [
          id,
          note,
          rerender,
          person,
        ]);
      expect({
        empty: await send("  ", true),
        rerender: await send("Make the reel again with the door move.", true),
        again: await send("Still too dark.", false),
        revise: await attempt(db, "select public.revise_proposed_post($1, '[]'::jsonb)", [id]),
      }).toEqual({
        empty: "rejection_note_required: Say what should change.",
        rerender: "ok",
        again: "wrong_state: This post was already decided.",
        revise: "validation: A proposed post needs at least one channel.",
      });
      const audit = await db.query<Record<string, unknown>>(
        "select action from public.audit_log where entity_id = $1 and actor_id = $2",
        [id, person],
      );
      expect(audit.rows).toEqual([{ action: "channels.proposed_rerender" }]);
    });
  });

  it("refuses a key that is not Matter's, whatever role it holds, so agent:matter is always Matter", async () => {
    await withRollback(async (db) => {
      await stored(db);
      const id = await propose(db, FAIRFIELD);
      const colleague = await createAuthUser(db);
      await db.query(
        "insert into public.user_roles (user_id, role, actor_kind) values ($1, 'chief_editor', 'agent')",
        [colleague],
      );
      expect({
        refused: await attempt(
          db,
          "select public.reject_proposed_post($1, 'Too dark.', false, $2, 'agent')",
          [id, colleague],
        ),
        status: await scalar<string>(
          db,
          "select status::text as v from public.proposed_posts where id = $1",
          [id],
        ),
      }).toEqual({ refused: "forbidden: ", status: "proposed" });
    });
  });
});
