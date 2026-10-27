// W8 item 4: the functions of Instagram comments and messages. A read records each item once by its Graph id, ties a
// comment to our post, emits one social.inbox_received per new row and moves its cursor forward only; a Social reply
// is filed in Approvals against one row; an approved reply enqueues one send, which begins once and records what
// became of it in Matter's thread; a declined one leaves the comment unanswered.
import { describe, expect, it } from "vitest";
import { createAuthUser, createStaffUser, withRollback, type Db } from "../fixtures/db";

const MEDIA = "w84-media-1";
const SLIDES = JSON.stringify([
  {
    role: "slide",
    index: 0,
    media_key: "requested/w84/slide-0.aaaaaaaa.jpg",
    w: 1080,
    h: 1350,
    bytes: 1,
  },
]);

async function scalar<T>(db: Db, sql: string, params: unknown[] = []): Promise<T> {
  const row = (await db.query<{ v: T }>(sql, params)).rows[0];
  if (row === undefined) throw new Error(`no row from: ${sql}`);
  return row.v;
}

/** One of our Instagram posts whose media id is `MEDIA`. */
async function ourPost(db: Db): Promise<string> {
  const asset = await scalar<string>(
    db,
    `select public.record_requested_asset('brand', 'carousel', $1::jsonb, 'Opening soon.', 'A line.', '{}'::jsonb) as v`,
    [SLIDES],
  );
  return scalar<string>(
    db,
    `insert into public.social_posts (asset_id, property_id, channel, status, scheduled_at, posted_at, remote_id)
     values ($1, null, 'instagram', 'posted', now(), now(), $2) returning id as v`,
    [asset, MEDIA],
  );
}

const items = JSON.stringify([
  {
    kind: "comment",
    graph_id: "w84-c1",
    thread_graph_id: MEDIA,
    parent_graph_id: null,
    author_handle: "reader",
    body: "Which architect?",
    received_at: "2026-10-27T10:00:00Z",
  },
  {
    kind: "message",
    graph_id: "w84-m1",
    thread_graph_id: "w84-t1",
    parent_graph_id: null,
    author_handle: "buyer",
    body: "Is it still for sale?",
    received_at: "2026-10-27T10:05:00Z",
  },
]);

const record = (db: Db, list: string, key: string, until: string | null) =>
  scalar<number>(db, "select public.social_inbox_record($1::jsonb, $2, $3::timestamptz) as v", [
    list,
    key,
    until,
  ]);

/** A recorded comment with a Social reply waiting in Approvals: the row's id, the approval's id and its hash. */
async function proposed(db: Db): Promise<{ inbox: string; approval: string; hash: string }> {
  await record(db, items, "instagram_comments", null);
  const inbox = await scalar<string>(
    db,
    "select id as v from public.social_inbox where graph_id = 'w84-c1'",
  );
  const agent = await scalar<string>(db, "select id as v from public.agents where slug = 'social'");
  const hash = "a".repeat(64);
  const approval = await scalar<string>(
    db,
    "select public.social_inbox_propose($1, $2, null, 'A reply', $3::jsonb, $4) as v",
    [inbox, agent, JSON.stringify({ inbox_id: inbox, body: "Thank you for asking." }), hash],
  );
  return { inbox, approval, hash };
}

/** Round 3: a person on record, who may approve a reply on Instagram (a human role row). */
const person = (db: Db) => createStaffUser(db, ["admin"]);

async function refusal(db: Db, sql: string, params: unknown[]): Promise<string> {
  await db.query("savepoint w84");
  try {
    await db.query(sql, params);
    await db.query("release savepoint w84");
    return "ok";
  } catch (error) {
    await db.query("rollback to savepoint w84");
    return error instanceof Error ? error.message : String(error);
  }
}

describe("social_inbox_record", () => {
  it("records each item once, ties a comment to our post, emits one event per new row and keeps the cursor", async () => {
    const seen = await withRollback(async (db) => {
      const post = await ourPost(db);
      const first = await record(db, items, "instagram_comments", "2026-10-27T10:05:00Z");
      const again = await record(db, items, "instagram_comments", "2026-10-27T09:00:00Z");
      const rows = await db.query<{
        graph_id: string;
        social_post_id: string | null;
        state: string;
      }>(
        "select graph_id, social_post_id, state from public.social_inbox where graph_id like 'w84-%' order by graph_id",
      );
      const events = await db.query<{ kind: string }>(
        `select e.payload ->> 'kind' as kind from public.events e
         join public.social_inbox s on s.id = e.entity_id
         where e.type = 'social.inbox_received' and s.graph_id like 'w84-%' order by 1`,
      );
      const cursor = await scalar<string>(
        db,
        "select read_until::text as v from public.social_inbox_cursors where key = 'instagram_comments'",
      );
      return { post, first, again, rows: rows.rows, events: events.rows, cursor };
    });
    expect(seen.first).toBe(2);
    expect(seen.again).toBe(0);
    expect(seen.rows).toEqual([
      { graph_id: "w84-c1", social_post_id: seen.post, state: "new" },
      { graph_id: "w84-m1", social_post_id: null, state: "new" },
    ]);
    expect(seen.events).toEqual([{ kind: "comment" }, { kind: "message" }]);
    expect(new Date(seen.cursor).toISOString()).toBe("2026-10-27T10:05:00.000Z");
  });

  it("never records a reply we sent as a comment, and refuses an item without its ids", async () => {
    const seen = await withRollback(async (db) => {
      const { inbox } = await proposed(db);
      await db.query("update public.social_inbox set reply_graph_id = 'w84-ours' where id = $1", [
        inbox,
      ]);
      const ours = JSON.stringify([
        {
          kind: "comment",
          graph_id: "w84-ours",
          thread_graph_id: MEDIA,
          author_handle: "matterofplace",
          body: "Thank you.",
          received_at: "2026-10-27T11:00:00Z",
        },
      ]);
      const added = await record(db, ours, "instagram_comments", null);
      const bad = await refusal(
        db,
        "select public.social_inbox_record($1::jsonb, 'instagram_comments')",
        [
          JSON.stringify([
            { kind: "comment", thread_graph_id: MEDIA, received_at: "2026-10-27T11:00:00Z" },
          ]),
        ],
      );
      return { added, bad };
    });
    expect(seen).toEqual({ added: 0, bad: "bad_request" });
  });
});

describe("a Social reply, from Approvals to the send", () => {
  it("files one proposal per comment and refuses a second or one naming another row", async () => {
    const seen = await withRollback(async (db) => {
      const { inbox, approval, hash } = await proposed(db);
      const row = await db.query<{ state: string; approval_id: string; action: string }>(
        `select s.state, s.approval_id, a.action from public.social_inbox s
         join public.agent_approvals a on a.id = s.approval_id where s.id = $1`,
        [inbox],
      );
      const agent = await scalar<string>(
        db,
        "select id as v from public.agents where slug = 'social'",
      );
      const second = await refusal(
        db,
        "select public.social_inbox_propose($1, $2, null, 'Again', $3::jsonb, $4)",
        [inbox, agent, JSON.stringify({ inbox_id: inbox, body: "Again." }), hash],
      );
      const other = await scalar<string>(
        db,
        "select id as v from public.social_inbox where graph_id = 'w84-m1'",
      );
      const mismatch = await refusal(
        db,
        "select public.social_inbox_propose($1, $2, null, 'x', $3::jsonb, $4)",
        [other, agent, JSON.stringify({ inbox_id: inbox, body: "Hi." }), hash],
      );
      return { row: row.rows[0], approval, second, mismatch };
    });
    expect(seen.row).toEqual({
      state: "proposed",
      approval_id: seen.approval,
      action: "reply_social",
    });
    expect(seen.second).toBe("wrong_state");
    expect(seen.mismatch).toBe("bad_request");
  });

  it("enqueues one send on approval; the send begins once and its outcome answers the comment and is said", async () => {
    const seen = await withRollback(async (db) => {
      const { inbox, approval, hash } = await proposed(db);
      await db.query(
        "select public.workforce_decide($1, 'approved', $2, $3, 'human', 'req-w84', null, $4)",
        [approval, hash, await person(db), "Thank you, the architect is named on the page."],
      );
      const jobs = await db.query<{ key: string }>(
        "select idempotency_key as key from public.jobs where type = 'send_social_reply'",
      );
      const first = await scalar<{ state: string; body: string; kind: string }>(
        db,
        "select public.social_inbox_reply_begin($1) as v",
        [approval],
      );
      const second = await scalar<{ state: string }>(
        db,
        "select public.social_inbox_reply_begin($1) as v",
        [approval],
      );
      await db.query("select public.social_inbox_reply_result($1, 'sent', 'w84-reply-1')", [inbox]);
      const after = await db.query<{ state: string; reply_state: string; reply_graph_id: string }>(
        "select state, reply_state, reply_graph_id from public.social_inbox where id = $1",
        [inbox],
      );
      const again = await refusal(
        db,
        "select public.social_inbox_reply_result($1, 'failed', null, 'x')",
        [inbox],
      );
      const said = await scalar<string>(
        db,
        "select body as v from public.agent_messages where thread = 'matter' order by created_at desc limit 1",
      );
      return { approval, jobs: jobs.rows, first, second, after: after.rows[0], again, said };
    });
    expect(seen.jobs).toEqual([{ key: `send_social_reply:${seen.approval}` }]);
    expect(seen.first).toMatchObject({
      state: "send",
      kind: "comment",
      body: "Thank you, the architect is named on the page.",
    });
    expect(seen.second).toMatchObject({ state: "sending" });
    expect(seen.after).toEqual({
      state: "answered",
      reply_state: "sent",
      reply_graph_id: "w84-reply-1",
    });
    expect(seen.again).toBe("wrong_state");
    expect(seen.said).toContain("Sent: the approved reply to an Instagram comment");
  });

  it("says a refused send and leaves the comment unanswered", async () => {
    const seen = await withRollback(async (db) => {
      const { inbox, approval, hash } = await proposed(db);
      await db.query(
        "select public.workforce_decide($1, 'approved', $2, $3, 'human', 'req-w84b')",
        [approval, hash, await person(db)],
      );
      await db.query("select public.social_inbox_reply_begin($1)", [approval]);
      await db.query(
        "select public.social_inbox_reply_result($1, 'refused', null, 'Posting is switched off here.')",
        [inbox],
      );
      const row = await db.query<{ state: string; reply_state: string }>(
        "select state, reply_state from public.social_inbox where id = $1",
        [inbox],
      );
      const said = await scalar<string>(
        db,
        "select body as v from public.agent_messages where thread = 'matter' order by created_at desc limit 1",
      );
      return { row: row.rows[0], said };
    });
    expect(seen.row).toEqual({ state: "proposed", reply_state: "refused" });
    expect(seen.said).toContain("Not sent: the approved reply to an Instagram comment");
  });

  it("leaves a declined reply's comment unanswered, with no send", async () => {
    const seen = await withRollback(async (db) => {
      const { inbox, approval } = await proposed(db);
      await db.query(
        "select public.workforce_decide($1, 'rejected', null, null, 'human', 'req-w84c', 'Too long.')",
        [approval],
      );
      const state = await scalar<string>(
        db,
        "select state as v from public.social_inbox where id = $1",
        [inbox],
      );
      const jobs = await scalar<number>(
        db,
        "select count(*)::int as v from public.jobs where type = 'send_social_reply' and idempotency_key = $1",
        [`send_social_reply:${approval}`],
      );
      return { state, jobs };
    });
    expect(seen).toEqual({ state: "ignored", jobs: 0 });
  });
});

const STATUS = "select public.set_subject_request_status($1, $2, $3, 'human', 'r-w84', $4)";

describe("W8 item 4 round 2", () => {
  const DECIDE = "select public.workforce_decide($1, $2, $3, $4, $5, 'req-w84r2', $6)";

  it("refuses an agent's or the system's approval of a reply with manual_approval, and lets an agent decline one", async () => {
    const seen = await withRollback(async (db) => {
      const { approval, hash } = await proposed(db);
      const agent = await scalar<string>(
        db,
        "select id as v from public.agents where slug = 'matter'",
      );
      const byAgent = await refusal(db, DECIDE, [approval, "approved", hash, agent, "agent", null]);
      const bySystem = await refusal(db, DECIDE, [
        approval,
        "approved",
        hash,
        null,
        "system",
        null,
      ]);
      const jobs = await scalar<number>(
        db,
        "select count(*)::int as v from public.jobs where type = 'send_social_reply' and idempotency_key = $1",
        [`send_social_reply:${approval}`],
      );
      const declined = await refusal(db, DECIDE, [
        approval,
        "rejected",
        null,
        agent,
        "agent",
        "Not ours to answer.",
      ]);
      return { byAgent, bySystem, jobs, declined };
    });
    expect(seen).toEqual({
      byAgent: "manual_approval",
      bySystem: "manual_approval",
      jobs: 0,
      declined: "ok",
    });
  });

  it("refuses at begin a reply approved with no person on record, in fixed words, and marks nothing", async () => {
    const seen = await withRollback(async (db) => {
      const { inbox, approval } = await proposed(db);
      await db.query("update public.agent_approvals set state = 'approved' where id = $1", [
        approval,
      ]);
      const begun = await scalar<{ state: string; reason: string }>(
        db,
        "select public.social_inbox_reply_begin($1) as v",
        [approval],
      );
      const replyState = await scalar<string | null>(
        db,
        "select reply_state as v from public.social_inbox where id = $1",
        [inbox],
      );
      return { state: begun.state, reason: begun.reason, replyState };
    });
    expect(seen).toEqual({
      state: "refuse",
      reason: "No person approved this reply: no write was made.",
      replyState: null,
    });
  });

  it("refuses at begin a message reply past the 24-hour window, in fixed words, before any send", async () => {
    const seen = await withRollback(async (db) => {
      await record(db, items, "instagram_messages", null);
      const inbox = await scalar<string>(
        db,
        "select id as v from public.social_inbox where graph_id = 'w84-m1'",
      );
      await db.query(
        "update public.social_inbox set received_at = now() - interval '25 hours' where thread_graph_id = 'w84-t1'",
      );
      const agent = await scalar<string>(
        db,
        "select id as v from public.agents where slug = 'social'",
      );
      const hash = "b".repeat(64);
      const approval = await scalar<string>(
        db,
        "select public.social_inbox_propose($1, $2, null, 'A reply', $3::jsonb, $4) as v",
        [inbox, agent, JSON.stringify({ inbox_id: inbox, body: "Yes, it is." }), hash],
      );
      await db.query(DECIDE, [approval, "approved", hash, await person(db), "human", null]);
      return scalar<{ state: string; reason: string }>(
        db,
        "select public.social_inbox_reply_begin($1) as v",
        [approval],
      );
    });
    expect({ state: seen.state, reason: seen.reason }).toEqual({
      state: "refuse",
      reason: "The 24-hour reply window closed: no write was made.",
    });
  });

  it("wakes Social at most ten times a read, says the rest once, and wakes no one for words without a letter", async () => {
    const seen = await withRollback(async (db) => {
      const many = JSON.stringify(
        Array.from({ length: 13 }, (_, n) => ({
          kind: "comment",
          graph_id: `w84-cap-${String(n)}`,
          thread_graph_id: MEDIA,
          author_handle: "reader",
          body: n === 0 ? "\u{1F3E0}\u{2728}" : `Comment ${String(n)}`,
          received_at: "2026-10-27T10:00:00Z",
          letters: n !== 0,
        })),
      );
      const added = await record(db, many, "instagram_comments", null);
      const woken = await scalar<number>(
        db,
        `select count(*)::int as v from public.events e join public.social_inbox s on s.id = e.entity_id
         where e.type = 'social.inbox_received' and s.graph_id like 'w84-cap-%'`,
      );
      const said = await db.query<{ body: string }>(
        "select body from public.agent_messages where thread = 'matter' and body like 'Instagram:%'",
      );
      return { added, woken, said: said.rows.map((row) => row.body) };
    });
    expect(seen).toEqual({
      added: 13,
      woken: 10,
      said: [
        "Instagram: 2 more comments or messages were recorded without waking Social (at most 10 a read). They wait on Social posts.",
      ],
    });
  });

  it("stops waking Social at fifty a day from Instagram and says so once that day", async () => {
    const seen = await withRollback(async (db) => {
      const today = await scalar<number>(
        db,
        `select count(*)::int as v from public.events
         where type = 'social.inbox_received' and at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'`,
      );
      for (let n = today; n < 48; n += 1) {
        await db.query(
          "select public.emit_event('social.inbox_received', 'social_inbox', gen_random_uuid(), '{}'::jsonb)",
        );
      }
      const batch = (prefix: string, count: number) =>
        JSON.stringify(
          Array.from({ length: count }, (_, n) => ({
            kind: "message",
            graph_id: `w84-day-${prefix}-${String(n)}`,
            thread_graph_id: "w84-day",
            body: "Hello",
            received_at: "2026-10-27T10:00:00Z",
            letters: true,
          })),
        );
      await record(db, batch("a", 5), "instagram_messages", null);
      await record(db, batch("b", 1), "instagram_messages", null);
      const woken = await scalar<number>(
        db,
        `select count(*)::int as v from public.events e join public.social_inbox s on s.id = e.entity_id
         where e.type = 'social.inbox_received' and s.graph_id like 'w84-day-%'`,
      );
      const lines = await scalar<number>(
        db,
        "select count(*)::int as v from public.agent_messages where body like 'Instagram: the daily limit of 50%'",
      );
      return { woken, lines };
    });
    expect(seen).toEqual({ woken: 2, lines: 1 });
  });

  it("refuses a reply longer than its kind takes, and re-arms a refused one on a new proposal", async () => {
    const seen = await withRollback(async (db) => {
      const { inbox, approval, hash } = await proposed(db);
      const agent = await scalar<string>(
        db,
        "select id as v from public.agents where slug = 'social'",
      );
      const message = await scalar<string>(
        db,
        "select id as v from public.social_inbox where graph_id = 'w84-m1'",
      );
      const tooLong = await refusal(
        db,
        "select public.social_inbox_propose($1, $2, null, 'x', $3::jsonb, 'h')",
        [message, agent, JSON.stringify({ inbox_id: message, body: "x".repeat(1001) })],
      );
      await db.query(DECIDE, [approval, "approved", hash, await person(db), "human", null]);
      await db.query("select public.social_inbox_reply_begin($1)", [approval]);
      await db.query(
        "select public.social_inbox_reply_result($1, 'refused', null, 'Instagram is switched off in Channels: no write was made.')",
        [inbox],
      );
      const said = await scalar<string>(
        db,
        "select body as v from public.agent_messages where thread = 'matter' order by created_at desc limit 1",
      );
      // A refusal is kept as its message, so a row that does not re-arm fails on the assertion below.
      await db.query("savepoint w84again");
      const again = await scalar<string>(
        db,
        "select public.social_inbox_propose($1, $2, null, 'Again', $3::jsonb, 'h2') as v",
        [inbox, agent, JSON.stringify({ inbox_id: inbox, body: "Thank you." })],
      ).catch(async (error: unknown) => {
        await db.query("rollback to savepoint w84again");
        return error instanceof Error ? error.message : String(error);
      });
      const row = await db.query<{
        state: string;
        reply_state: string | null;
        approval_id: string;
      }>("select state, reply_state, approval_id from public.social_inbox where id = $1", [inbox]);
      return { tooLong, said, again, row: row.rows[0] };
    });
    expect(seen.tooLong).toBe("reply_too_long");
    expect(seen.said).toContain("Instagram is switched off in Channels: no write was made.");
    expect(seen.row).toEqual({ state: "proposed", reply_state: null, approval_id: seen.again });
  });

  it("deletes the comments and messages of the Instagram handle a deletion request names", async () => {
    const seen = await withRollback(async (db) => {
      await record(db, items, "instagram_comments", null);
      const admin = await createStaffUser(db, ["admin"]);
      const id = await scalar<string>(
        db,
        "insert into public.subject_requests (email, kind) values ('w84@example.net', 'deletion') returning id as v",
      );
      await db.query(STATUS, [id, "start_verification", admin, null]);
      await db.query(STATUS, [id, "confirm_identity", admin, "Wrote from the account."]);
      const result = await scalar<{ counts: Record<string, number> }>(
        db,
        "select public.delete_subject($1, $2, 'human', 'r-w84', ' @Reader ') as v",
        [id, admin],
      );
      const left = await db.query<{ graph_id: string }>(
        "select graph_id from public.social_inbox where graph_id like 'w84-%' order by graph_id",
      );
      return { removed: result.counts["social_inbox"], left: left.rows.map((row) => row.graph_id) };
    });
    expect(seen).toEqual({ removed: 1, left: ["w84-m1"] });
  });
});

describe("W8 item 4 round 3", () => {
  const RECORD4 =
    "select public.social_inbox_record($1::jsonb, $2, $3::timestamptz, $4::jsonb) as v";
  const DECIDE3 =
    "select public.workforce_decide($1, 'approved', $2, $3, 'human', 'req-w84r3', null, $4)";
  const PART = {
    [MEDIA]: {
      edge: "comments",
      thread: MEDIA,
      after: "p5",
      since: "2026-10-26T10:00:00.000Z",
      started: "2026-10-27T10:00:00.000Z",
    },
  };

  /** An access or deletion request whose identity is confirmed, and the admin who handles it. */
  async function confirmed(db: Db, kind: "access" | "deletion") {
    const admin = await person(db);
    const id = await scalar<string>(
      db,
      "insert into public.subject_requests (email, kind) values ('w84r3@example.net', $1) returning id as v",
      [kind],
    );
    await db.query(STATUS, [id, "start_verification", admin, null]);
    await db.query(STATUS, [id, "confirm_identity", admin, "Wrote from the account."]);
    return { admin, id };
  }

  it("keeps the lists a read left part way with its cursor, and the next read's lists replace them", async () => {
    const seen = await withRollback(async (db) => {
      const pending = () =>
        scalar<unknown>(
          db,
          "select pending as v from public.social_inbox_cursors where key = 'instagram_comments'",
        );
      await db.query(RECORD4, [
        "[]",
        "instagram_comments",
        "2026-10-27T10:00:00Z",
        JSON.stringify(PART),
      ]);
      const first = await pending();
      await db.query(RECORD4, ["[]", "instagram_comments", "2026-10-27T10:15:00Z", "{}"]);
      const second = await pending();
      const bad = await refusal(db, RECORD4, ["[]", "instagram_comments", null, "[]"]);
      return { first, second, bad };
    });
    expect(seen).toEqual({ first: PART, second: {}, bad: "bad_request" });
  });

  it("takes one lock for a read, so two reads that overlap spend the daily wakes one after the other", async () => {
    const held = await withRollback(async (db) => {
      await record(db, "[]", "instagram_comments", null);
      return scalar<number>(
        db,
        `select count(*)::int as v from pg_locks
         where locktype = 'advisory' and pid = pg_backend_pid()
           and objid::bigint = (hashtext('social_inbox_record')::bigint & 4294967295)`,
      );
    });
    expect(held).toBe(1);
  });

  it("refuses an approval from an id with no human role row, at decide and at begin", async () => {
    const seen = await withRollback(async (db) => {
      const { inbox, approval, hash } = await proposed(db);
      const nobody = await createAuthUser(db);
      const decided = await refusal(db, DECIDE3, [approval, hash, nobody, null]);
      // An approval recorded by any other path, with that id as its decider, is still refused before any send.
      await db.query(
        "update public.agent_approvals set state = 'approved', decided_by = $2 where id = $1",
        [approval, nobody],
      );
      const begun = await scalar<{ state: string; reason: string }>(
        db,
        "select public.social_inbox_reply_begin($1) as v",
        [approval],
      );
      const replyState = await scalar<string | null>(
        db,
        "select reply_state as v from public.social_inbox where id = $1",
        [inbox],
      );
      return { decided, state: begun.state, reason: begun.reason, replyState };
    });
    expect(seen).toEqual({
      decided: "manual_approval",
      state: "refuse",
      reason: "No person approved this reply: no write was made.",
      replyState: null,
    });
  });

  it("refuses a person's edit of a reply longer than its kind takes, and takes one within it", async () => {
    const seen = await withRollback(async (db) => {
      const { approval, hash } = await proposed(db);
      const admin = await person(db);
      const tooLong = await refusal(db, DECIDE3, [approval, hash, admin, "x".repeat(2201)]);
      const fits = await refusal(db, DECIDE3, [approval, hash, admin, "x".repeat(2200)]);
      return { tooLong, fits };
    });
    expect(seen).toEqual({ tooLong: "validation", fits: "ok" });
  });

  it("exports the comments and messages of the Instagram handle an access request names, and none without one", async () => {
    const seen = await withRollback(async (db) => {
      await record(db, items, "instagram_comments", null);
      const named = await confirmed(db, "access");
      const bundle = await scalar<{ social_inbox: { graph_id: string }[] }>(
        db,
        "select public.export_subject($1, $2, 'human', 'r-w84r3', ' @Reader ') as v",
        [named.id, named.admin],
      );
      const unnamed = await confirmed(db, "access");
      const none = await scalar<{ social_inbox: unknown[] }>(
        db,
        "select public.export_subject($1, $2, 'human', 'r-w84r3b') as v",
        [unnamed.id, unnamed.admin],
      );
      return {
        named: bundle.social_inbox.map((row) => row.graph_id),
        none: none.social_inbox.length,
      };
    });
    expect(seen).toEqual({ named: ["w84-c1"], none: 0 });
  });

  it("deletes the lines held for Matter about a deleted handle's comments, and no other line", async () => {
    const seen = await withRollback(async (db) => {
      await record(db, items, "instagram_comments", null);
      const inbox = await scalar<string>(
        db,
        "select id::text as v from public.social_inbox where graph_id = 'w84-c1'",
      );
      const other = await scalar<string>(
        db,
        "select id::text as v from public.social_inbox where graph_id = 'w84-m1'",
      );
      const held = (id: string) =>
        scalar<string>(
          db,
          `insert into public.agent_messages (thread, author_kind, author_id, author_name, body)
           values ('social', 'system', 'triage', 'Triage', $1) returning id::text as v`,
          [`@matter An outside message was held.\nFrom: reader.\nRecord: social_comment ${id}.`],
        );
      const tied = await held(inbox);
      const kept = await held(other);
      const named = await confirmed(db, "deletion");
      await db.query("select public.delete_subject($1, $2, 'human', 'r-w84r3c', 'reader')", [
        named.id,
        named.admin,
      ]);
      const left = await db.query<{ id: string }>(
        "select id::text from public.agent_messages where id = any ($1::uuid[])",
        [[tied, kept]],
      );
      return { left: left.rows.map((row) => row.id), kept };
    });
    expect(seen.left).toEqual([seen.kept]);
  });
});
