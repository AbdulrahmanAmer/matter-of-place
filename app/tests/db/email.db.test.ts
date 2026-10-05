// B5 step 2: the email migrations (invariants 4, 5, 7, 8, 9 and 12, G20, G43, DL-06, GG-05). Every case runs in one
// rolled-back transaction (F22); each case writes fresh addresses and ids, and the counts compare a before and an after.
import { randomUUID } from "node:crypto";
import pg from "pg";
import { describe, expect, it } from "vitest";
import {
  emailTemplateKeys,
  emailTemplateSchema,
  variablesByKey,
  type EmailTemplateRow,
} from "../../src/domain/email";
import { asRole, createStaffUser, dbNow, withRollback, type Db } from "../fixtures/db";

async function one<T extends object>(db: Db, sql: string, params: unknown[] = []): Promise<T> {
  const row = (await db.query<T>(sql, params)).rows[0];
  if (row === undefined) throw new Error(`no row from: ${sql}`);
  return row;
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

const address = () => `test-${randomUUID()}@example.test`;

// The Contract's class of each of B5's keys (INT-03).
const classes: Record<string, string> = {
  admin_notify: "alert",
  standalone: "bulk",
  repermission: "bulk",
};

async function job(db: Db): Promise<string> {
  const { id } = await one<{ id: string }>(
    db,
    "insert into public.jobs (type, idempotency_key) values ('send_email', $1) returning id",
    [`test:${randomUUID()}`],
  );
  return id;
}

interface Begun {
  id: string;
  status: string;
  content_hash: string;
}

async function begin(db: Db, jobId: string, to: string, hash: string): Promise<Begun> {
  return one<Begun>(
    db,
    "select * from public.email_message_begin($1, $2, 'received', 'transactional', 'Subject', 'submission', null, $3)",
    [jobId, to, hash],
  );
}

/** One email_messages row written directly; `sentAt` is SQL evaluated in the test's transaction. */
async function message(db: Db, status: string, sentAt: string): Promise<void> {
  await db.query(
    `insert into public.email_messages (template_key, kind, to_email, status, sent_at)
     values ('received', 'transactional', $1, $2, ${sentAt})`,
    [address(), status],
  );
}

async function apply(db: Db, event: Record<string, unknown>): Promise<boolean> {
  const { applied } = await one<{ applied: boolean }>(
    db,
    "select public.apply_email_event($1::jsonb) as applied",
    [JSON.stringify({ provider_event_id: `msg_${randomUUID()}`, ...event })],
  );
  return applied;
}

/** A sent message with its Resend id, as the send step leaves it. */
async function sentMessage(db: Db, to: string): Promise<string> {
  const resendId = `re_${randomUUID()}`;
  await db.query(
    `insert into public.email_messages (template_key, kind, to_email, status, resend_id, sent_at)
     values ('received', 'transactional', $1, 'sent', $2, now())`,
    [to, resendId],
  );
  return resendId;
}

async function suppressed(db: Db, email: string): Promise<string | null> {
  const read = await db.query<{ reason: string }>(
    "select reason from public.email_suppressions where email = $1",
    [email],
  );
  return read.rows[0]?.reason ?? null;
}

async function ownAudience(db: Db): Promise<void> {
  await db.query(
    `insert into public.settings (key, value) values ('resend', '{"audiences": {"place_notes": "aud_test"}}')
     on conflict (key) do update set value = excluded.value`,
  );
}

/** A subscriber row written directly; an insert fires no engagement trigger. */
async function subscriber(db: Db, columns: Record<string, string>): Promise<string> {
  const names = ["email", "source", ...Object.keys(columns)];
  const values = ["$1", "'place_notes'", ...Object.values(columns)];
  const { id } = await one<{ id: string }>(
    db,
    `insert into public.subscribers (${names.join(", ")}) values (${values.join(", ")}) returning id`,
    [address()],
  );
  return id;
}

async function createdEvents(db: Db, subscriberId: string): Promise<Record<string, unknown>[]> {
  return (
    await db.query<{ payload: Record<string, unknown> }>(
      "select payload from public.events where type = 'subscriber.created' and entity_id = $1 order by at",
      [subscriberId],
    )
  ).rows.map((row) => row.payload);
}

async function upsert(db: Db, payload: Record<string, unknown>): Promise<string> {
  const { id } = await one<{ id: string }>(db, "select public.upsert_subscriber($1::jsonb) as id", [
    JSON.stringify(payload),
  ]);
  return id;
}

async function confirm(db: Db, hash: string): Promise<string | null> {
  const { id } = await one<{ id: string | null }>(
    db,
    "select public.confirm_subscriber($1) as id",
    [hash],
  );
  return id;
}

interface SubscriberState {
  source: string;
  pending_source: string | null;
  confirmed: boolean;
  unsubscribed: boolean;
  archived: boolean;
  hash: string | null;
  engaged: boolean;
  asked: boolean;
}

async function state(db: Db, id: string): Promise<SubscriberState> {
  return one<SubscriberState>(
    db,
    `select source, pending_source, confirmed_at is not null as confirmed, unsubscribed_at is not null as unsubscribed,
       archived_at is not null as archived, confirm_token_hash as hash, last_engaged_at is not null as engaged,
       repermission_sent_at is not null as asked
     from public.subscribers where id = $1`,
    [id],
  );
}

describe("seed and send class", () => {
  it("the seeded keys equal emailTemplateKeys and each row parses with its class and variables", async () => {
    const rows = await withRollback(
      async (db) => (await db.query<EmailTemplateRow>("select * from public.email_templates")).rows,
    );
    const seeded = rows.filter((row) => (emailTemplateKeys as readonly string[]).includes(row.key));
    expect(new Set(rows.map((row) => row.key))).toEqual(new Set(emailTemplateKeys));
    expect(seeded.map((row) => emailTemplateSchema.parse(row))).toHaveLength(
      emailTemplateKeys.length,
    );
    expect(Object.fromEntries(seeded.map((row) => [row.key, [row.class, row.variables]]))).toEqual(
      Object.fromEntries(
        emailTemplateKeys.map((key) => [
          key,
          [classes[key] ?? "transactional", [...variablesByKey[key]]],
        ]),
      ),
    );
  });

  it("an insert without class fails with 23502", async () => {
    const outcome = await withRollback(async (db) =>
      attempt(
        db,
        "insert into public.email_templates (key, subject, body) values ($1, 'Subject', '[]')",
        [`test_${randomUUID()}`],
      ),
    );
    expect(outcome.split(" ")[0]).toBe("23502");
  });

  it("settings.email holds the build share while the stage is not production", async () => {
    const read = await withRollback(async (db) =>
      one<{ stage: string; value: unknown }>(
        db,
        `select (select value #>> '{}' from public.settings where key = 'environment') as stage,
           (select value from public.settings where key = 'email') as value`,
      ),
    );
    expect(read.stage).not.toBe("production");
    expect(read.value).toEqual({
      daily_cap: 15,
      bulk_cap: 5,
      monthly_cap: 300,
      dev_recipients: ["admin@matterofplace.com", "admin+*@matterofplace.com", "*@resend.dev"],
    });
  });

  it("share: set_environment moves settings.email to the share of the new stage", async () => {
    const shares = await withRollback(async (db) => {
      const share = async () =>
        (
          await one<{ share: string }>(
            db,
            `select concat_ws('|', value ->> 'daily_cap', value ->> 'bulk_cap', value ->> 'monthly_cap',
               jsonb_array_length(value -> 'dev_recipients')) as share
             from public.settings where key = 'email'`,
          )
        ).share;
      // set_environment('production') refuses while an Illustrative property exists (B3b invariant 1).
      await db.query("select set_config('mop.retention', 'on', true)");
      await db.query("delete from public.properties where status = 'Illustrative'");
      await db.query("select public.set_environment('production')");
      const production = await share();
      await db.query("select public.set_environment('development')");
      return { production, development: await share() };
    });
    expect(shares).toEqual({ production: "75|50|2600|0", development: "15|5|300|3" });
  });
});

describe("email_messages", () => {
  it("email_message_begin keeps one row per job and recipient, and a retry after the send sees sent", async () => {
    const result = await withRollback(async (db) => {
      const jobId = await job(db);
      const to = address();
      const first = await begin(db, jobId, to, "hash-1");
      const second = await begin(db, jobId, to, "hash-1");
      await db.query("select public.email_message_finish($1, 'sent', 're_1', null)", [first.id]);
      const third = await begin(db, jobId, to, "hash-1");
      return {
        first,
        sameId: second.id === first.id && third.id === first.id,
        third: third.status,
      };
    });
    expect(result).toEqual({
      first: { id: result.first.id, status: "queued", content_hash: "hash-1" },
      sameId: true,
      third: "sent",
    });
  });

  it("a second email_message_begin with another content hash returns the first hash", async () => {
    const hashes = await withRollback(async (db) => {
      const jobId = await job(db);
      const to = address();
      await begin(db, jobId, to, "hash-first");
      return (await begin(db, jobId, to, "hash-second")).content_hash;
    });
    expect(hashes).toBe("hash-first");
  });

  it("email_message_finish: skipped leaves sent_at null, a sent row never moves, another status is refused", async () => {
    const result = await withRollback(async (db) => {
      const skipped = await begin(db, await job(db), address(), "h");
      await db.query("select public.email_message_finish($1, 'skipped', 'dry_1', 'dry_run')", [
        skipped.id,
      ]);
      const sent = await begin(db, await job(db), address(), "h");
      await db.query("select public.email_message_finish($1, 'sent', 're_2', null)", [sent.id]);
      await db.query("select public.email_message_finish($1, 'failed', null, 'late')", [sent.id]);
      const read = async (id: string) =>
        one<{ status: string; sent: boolean; error: string | null }>(
          db,
          "select status, sent_at is not null as sent, error from public.email_messages where id = $1",
          [id],
        );
      return {
        skipped: await read(skipped.id),
        sent: await read(sent.id),
        delivered: await attempt(
          db,
          "select public.email_message_finish($1, 'delivered', null, null)",
          [sent.id],
        ),
      };
    });
    expect(result).toEqual({
      skipped: { status: "skipped", sent: false, error: "dry_run" },
      sent: { status: "sent", sent: true, error: null },
      delivered: "P0001 invalid_status",
    });
  });

  it("a second row for one job and recipient is refused", async () => {
    const outcome = await withRollback(async (db) => {
      const jobId = await job(db);
      const insert = `insert into public.email_messages (template_key, kind, to_email, job_id)
        values ('received', 'transactional', 'same@example.test', $1)`;
      await db.query(insert, [jobId]);
      return attempt(db, insert, [jobId]);
    });
    expect(outcome.split(" ")[0]).toBe("23505");
  });

  it("deleting a done job leaves its message with job_id null", async () => {
    const result = await withRollback(async (db) => {
      const jobId = await job(db);
      const { id } = await begin(db, jobId, address(), "h");
      await db.query("update public.jobs set status = 'done', finished_at = now() where id = $1", [
        jobId,
      ]);
      await db.query("select set_config('mop.retention', 'on', true)");
      const deleted = await attempt(db, "delete from public.jobs where id = $1", [jobId]);
      const rows = await db.query<{ job_id: string | null }>(
        "select job_id from public.email_messages where id = $1",
        [id],
      );
      return { deleted, rows: rows.rows };
    });
    expect(result).toEqual({ deleted: "ok", rows: [{ job_id: null }] });
  });
});

describe("daily and monthly counts", () => {
  it("email_sent_today counts today's sent rows whatever their status, and no queued, failed, skipped or older row", async () => {
    const counts = await withRollback(async (db) => {
      const count = async () =>
        (await one<{ n: number }>(db, "select public.email_sent_today() as n")).n;
      const before = await count();
      for (const status of ["sent", "delivered", "bounced"]) await message(db, status, "now()");
      for (const status of ["queued", "failed", "skipped"]) await message(db, status, "null");
      await message(db, "sent", "now() - interval '1 day'");
      return { before, after: await count() };
    });
    expect(counts.after - counts.before).toBe(3);
  });

  it("email_sent_month counts this month's sent rows and not last month's", async () => {
    const counts = await withRollback(async (db) => {
      const count = async () =>
        (await one<{ n: number }>(db, "select public.email_sent_month() as n")).n;
      const before = await count();
      await message(db, "delivered", "now()");
      await message(db, "queued", "null");
      await message(
        db,
        "sent",
        "date_trunc('month', now() at time zone 'utc') at time zone 'utc' - interval '1 minute'",
      );
      return { before, after: await count() };
    });
    expect(counts.after - counts.before).toBe(1);
  });
});

describe("apply_email_event", () => {
  it("apply_email_event moves a message forward only", async () => {
    const statuses = await withRollback(async (db) => {
      const to = address();
      const resendId = await sentMessage(db, to);
      const status = async () =>
        (
          await one<{ status: string }>(
            db,
            "select status from public.email_messages where resend_id = $1",
            [resendId],
          )
        ).status;
      const event = (type: string, data: Record<string, unknown> = {}) =>
        apply(db, { type, resend_email_id: resendId, to_email: to, data });
      await event("email.delivered");
      const delivered = await status();
      await event("email.bounced", { bounce_type: "Transient" });
      const bounced = await status();
      await event("email.delivered");
      return [delivered, bounced, await status()];
    });
    expect(statuses).toEqual(["delivered", "bounced", "bounced"]);
  });

  it("apply_email_event: a replayed provider_event_id returns false and changes nothing", async () => {
    const result = await withRollback(async (db) => {
      const to = address();
      const resendId = await sentMessage(db, to);
      const event = {
        provider_event_id: `msg_${randomUUID()}`,
        resend_email_id: resendId,
        to_email: to,
      };
      const first = await apply(db, { ...event, type: "email.delivered" });
      const replay = await apply(db, {
        ...event,
        type: "email.bounced",
        data: { bounce_type: "Permanent" },
      });
      const read = await one<{ status: string; events: number }>(
        db,
        `select m.status, (select count(*)::int from public.email_events e where e.resend_email_id = $1) as events
         from public.email_messages m where m.resend_id = $1`,
        [resendId],
      );
      return { first, replay, ...read, suppressed: await suppressed(db, to) };
    });
    expect(result).toEqual({
      first: true,
      replay: false,
      status: "delivered",
      events: 1,
      suppressed: null,
    });
  });

  it("apply_email_event suppresses on a permanent bounce and on a complaint", async () => {
    const reasons = await withRollback(async (db) => {
      const bounced = address();
      const complained = address();
      await apply(db, {
        type: "email.bounced",
        resend_email_id: await sentMessage(db, bounced),
        to_email: bounced.toUpperCase(),
        data: { bounce_type: "Permanent" },
      });
      await apply(db, {
        type: "email.complained",
        resend_email_id: await sentMessage(db, complained),
        to_email: complained,
      });
      return [await suppressed(db, bounced), await suppressed(db, complained)];
    });
    expect(reasons).toEqual(["bounce", "complaint"]);
  });

  it("apply_email_event suppresses on the third transient bounce within 30 days only", async () => {
    const result = await withRollback(async (db) => {
      const now = (await dbNow(db)).getTime();
      const daysAgo = (days: number) => new Date(now - days * 86_400_000).toISOString();
      const bounce = (to: string, days: number) =>
        apply(db, {
          type: "email.bounced",
          to_email: to,
          at: daysAgo(days),
          data: { bounce_type: "Transient" },
        });
      const near = address();
      const spread = address();
      await bounce(near, 20);
      await bounce(near, 10);
      const afterTwo = await suppressed(db, near);
      await bounce(near, 0);
      await bounce(spread, 31);
      await bounce(spread, 1);
      await bounce(spread, 0);
      return {
        afterTwo,
        afterThree: await suppressed(db, near),
        spread: await suppressed(db, spread),
      };
    });
    expect(result).toEqual({ afterTwo: null, afterThree: "bounce", spread: null });
  });

  it("apply_email_event: a click sets subscribers.last_engaged_at", async () => {
    const engaged = await withRollback(async (db) => {
      const id = await subscriber(db, { confirmed_at: "now() - interval '2 years'" });
      const { email } = await one<{ email: string }>(
        db,
        "select email from public.subscribers where id = $1",
        [id],
      );
      await apply(db, {
        type: "email.clicked",
        to_email: email,
        data: { link: "https://matterofplace.com/" },
      });
      return (await state(db, id)).engaged;
    });
    expect(engaged).toBe(true);
  });

  it("apply_email_event: contact.updated with unsubscribed true unsubscribes once and clears the hash", async () => {
    const result = await withRollback(async (db) => {
      await ownAudience(db);
      const id = await subscriber(db, { confirmed_at: "now()", confirm_token_hash: "'hash-old'" });
      const { email } = await one<{ email: string }>(
        db,
        "select email from public.subscribers where id = $1",
        [id],
      );
      const event = {
        provider_event_id: `msg_${randomUUID()}`,
        type: "contact.updated",
        audience_id: "aud_test",
        to_email: email,
        data: { unsubscribed: true },
      };
      const at = async () =>
        (
          await one<{ at: string }>(
            db,
            "select unsubscribed_at::text as at from public.subscribers where id = $1",
            [id],
          )
        ).at;
      const first = await apply(db, event);
      const unsubscribedAt = await at();
      const replay = await apply(db, event);
      return {
        first,
        replay,
        unchanged: (await at()) === unsubscribedAt,
        hash: (await state(db, id)).hash,
      };
    });
    expect(result).toEqual({ first: true, replay: false, unchanged: true, hash: null });
  });

  it("apply_email_event drops a contact or broadcast event of a foreign audience and keeps its own broadcast_id", async () => {
    const result = await withRollback(async (db) => {
      await ownAudience(db);
      const foreignId = `msg_${randomUUID()}`;
      const ownId = `msg_${randomUUID()}`;
      const foreign = await apply(db, {
        provider_event_id: foreignId,
        type: "contact.updated",
        audience_id: "aud_other",
        to_email: address(),
        data: { unsubscribed: true },
      });
      const own = await apply(db, {
        provider_event_id: ownId,
        type: "email.delivered",
        broadcast_id: "bc_test",
        audience_id: "aud_test",
        to_email: address(),
      });
      const rows = await db.query<{ own: boolean; broadcast_id: string | null }>(
        `select provider_event_id = $2 as own, broadcast_id from public.email_events
         where provider_event_id in ($1, $2)`,
        [foreignId, ownId],
      );
      return { foreign, own, rows: rows.rows };
    });
    expect(result).toEqual({
      foreign: false,
      own: true,
      rows: [{ own: true, broadcast_id: "bc_test" }],
    });
  });

  it("email_events.provider_event_id is unique", async () => {
    const outcome = await withRollback(async (db) => {
      const insert =
        "insert into public.email_events (provider_event_id, type, at) values ('msg_same_test', 'email.sent', now())";
      await db.query(insert);
      return attempt(db, insert);
    });
    expect(outcome.split(" ")[0]).toBe("23505");
  });
});

describe("retention row", () => {
  it("email_pii is 90 days, anonymise", async () => {
    const rows = await withRollback(
      async (db) =>
        (
          await db.query<{ key: string; keep_for: string; action: string }>(
            "select key, keep_for::text, action from public.retention_policies where key = 'email_pii'",
          )
        ).rows,
    );
    expect(rows).toEqual([{ key: "email_pii", keep_for: "90 days", action: "anonymise" }]);
  });
});

describe("subscriber.created (G20, DL-06)", () => {
  it("upsert_subscriber writes one subscriber.created with the sealed token for a new address, none for a covered one or without a token", async () => {
    const result = await withRollback(async (db) => {
      const email = address();
      const id = await upsert(db, {
        email,
        source: "place_notes",
        markets: [],
        confirm_token_hash: "hash-new",
        sealed_token: "sealed-new",
      });
      const created = await createdEvents(db, id);
      await confirm(db, "hash-new");
      await upsert(db, {
        email,
        source: "place_notes",
        markets: [],
        confirm_token_hash: "hash-again",
        sealed_token: "sealed-again",
      });
      const unsealed = await upsert(db, {
        email: address(),
        source: "place_notes",
        markets: [],
        confirm_token_hash: "hash-unsealed",
      });
      return {
        created,
        afterCovered: (await createdEvents(db, id)).length,
        unsealed: (await createdEvents(db, unsealed)).length,
        id,
      };
    });
    expect(result).toEqual({
      created: [{ subscriber_id: result.id, sealed_token: "sealed-new" }],
      afterCovered: 1,
      unsealed: 0,
      id: result.id,
    });
  });

  it("a confirmed interest row asking for Place Notes writes one event and keeps its source until the confirm", async () => {
    const result = await withRollback(async (db) => {
      const email = address();
      const id = await upsert(db, {
        email,
        source: "interest:california",
        markets: ["california"],
        confirm_token_hash: "hash-interest",
        sealed_token: "sealed-interest",
      });
      await confirm(db, "hash-interest");
      await upsert(db, {
        email,
        source: "place_notes",
        markets: [],
        confirm_token_hash: "hash-notes",
        sealed_token: "sealed-notes",
      });
      const waiting = await state(db, id);
      await confirm(db, "hash-notes");
      const done = await state(db, id);
      return {
        events: (await createdEvents(db, id)).length,
        waiting: [waiting.source, waiting.pending_source],
        done: [done.source, done.pending_source],
      };
    });
    expect(result).toEqual({
      events: 2,
      waiting: ["interest:california", "place_notes"],
      done: ["place_notes", null],
    });
  });

  it("an unsubscribed address that signs up again writes one event and its confirm subscribes it again", async () => {
    const result = await withRollback(async (db) => {
      const email = address();
      const signup = (hash: string) =>
        upsert(db, {
          email,
          source: "place_notes",
          markets: [],
          confirm_token_hash: hash,
          sealed_token: `sealed-${hash}`,
        });
      const id = await signup("hash-a");
      await confirm(db, "hash-a");
      await db.query("select public.unsubscribe_email($1)", [email]);
      await signup("hash-b");
      const events = (await createdEvents(db, id)).length;
      await confirm(db, "hash-b");
      const after = await state(db, id);
      return { events, unsubscribed: after.unsubscribed, confirmed: after.confirmed };
    });
    expect(result).toEqual({ events: 2, unsubscribed: false, confirmed: true });
  });
});

describe("list hygiene (GG-05)", () => {
  it("repermission_candidates returns the idle consenting subscriber and no other", async () => {
    const result = await withRollback(async (db) => {
      const idle = "now() - interval '13 months'";
      const ids = {
        idle: await subscriber(db, { confirmed_at: idle }),
        recent: await subscriber(db, { confirmed_at: "now() - interval '11 months'" }),
        suppressed: await subscriber(db, { confirmed_at: idle }),
        unsubscribed: await subscriber(db, { confirmed_at: idle, unsubscribed_at: "now()" }),
        archived: await subscriber(db, { confirmed_at: idle, archived_at: "now()" }),
        asked: await subscriber(db, {
          confirmed_at: idle,
          repermission_sent_at: "now() - interval '1 day'",
        }),
      };
      await db.query(
        `insert into public.email_suppressions (email, reason)
         select lower(email), 'manual' from public.subscribers where id = $1`,
        [ids.suppressed],
      );
      const candidates = new Set(
        (
          await db.query<{ id: string }>("select id from public.repermission_candidates(100000)")
        ).rows.map((row) => row.id),
      );
      return Object.fromEntries(
        Object.entries(ids).map(([name, id]) => [name, candidates.has(id)]),
      );
    });
    expect(result).toEqual({
      idle: true,
      recent: false,
      suppressed: false,
      unsubscribed: false,
      archived: false,
      asked: false,
    });
  });

  it("a confirm sets last_engaged_at and clears repermission_sent_at", async () => {
    const after = await withRollback(async (db) => {
      const id = await subscriber(db, {
        confirmed_at: "now() - interval '13 months'",
        confirm_token_hash: "'hash-reconfirm'",
        repermission_sent_at: "now() - interval '2 days'",
      });
      await confirm(db, "hash-reconfirm");
      const read = await state(db, id);
      return { engaged: read.engaged, asked: read.asked };
    });
    expect(after).toEqual({ engaged: true, asked: false });
  });

  it("issue_repermission asks a consenting subscriber only, and confirm_subscriber answers the ask", async () => {
    const result = await withRollback(async (db) => {
      const ask = async (id: string, hash: string) =>
        (
          await one<{ asked: boolean }>(db, "select public.issue_repermission($1, $2) as asked", [
            id,
            hash,
          ])
        ).asked;
      const confirmed = await subscriber(db, { confirmed_at: "now() - interval '13 months'" });
      const unconfirmed = await subscriber(db, {});
      const unsubscribed = await subscriber(db, {
        confirmed_at: "now()",
        unsubscribed_at: "now()",
      });
      const asks = [
        await ask(confirmed, "hash-rp"),
        await ask(unconfirmed, "hash-x"),
        await ask(unsubscribed, "hash-y"),
      ];
      const confirmedNow = async () =>
        (
          await one<{ now: boolean }>(
            db,
            "select confirmed_at = now() as now from public.subscribers where id = $1",
            [confirmed],
          )
        ).now;
      const asked = await state(db, confirmed);
      const before = await confirmedNow();
      const matched = await confirm(db, "hash-rp");
      const answered = await state(db, confirmed);
      return {
        asks,
        stored: [asked.hash, asked.asked],
        matched: matched === confirmed,
        confirmedAt: [before, await confirmedNow()],
        answered: [answered.engaged, answered.asked, answered.hash],
      };
    });
    expect(result).toEqual({
      asks: [true, false, false],
      stored: ["hash-rp", true],
      matched: true,
      confirmedAt: [false, true],
      answered: [true, false, null],
    });
  });

  it("lapse_subscribers archives an unanswered ask, keeps a click since and a recent ask, and writes one system audit row", async () => {
    const result = await withRollback(async (db) => {
      const asked = (days: number) => `now() - interval '${String(days)} days'`;
      const old = "now() - interval '2 years'";
      const ids = {
        idle: await subscriber(db, { confirmed_at: old, repermission_sent_at: asked(31) }),
        clicked: await subscriber(db, {
          confirmed_at: old,
          repermission_sent_at: asked(31),
          last_engaged_at: asked(5),
        }),
        recent: await subscriber(db, { confirmed_at: old, repermission_sent_at: asked(10) }),
      };
      const { count } = await one<{ count: number }>(
        db,
        "select public.lapse_subscribers() as count",
      );
      const audit = await db.query<{
        actor_id: string | null;
        actor_kind: string | null;
        entity: string;
        after: unknown;
      }>(
        `select actor_id, actor_kind, entity, after from public.audit_log
         where action = 'subscribers.lapse' and at = now()`,
      );
      const archived: Record<string, boolean> = {};
      for (const [name, id] of Object.entries(ids)) archived[name] = (await state(db, id)).archived;
      return { count, archived, audit: audit.rows };
    });
    expect(result.archived).toEqual({ idle: true, clicked: false, recent: false });
    expect(result.audit).toEqual([
      { actor_id: null, actor_kind: null, entity: "subscribers", after: { count: result.count } },
    ]);
  });

  it("lapse_subscribers clears the hash, so a late re-permission link matches no row", async () => {
    const result = await withRollback(async (db) => {
      const id = await subscriber(db, { confirmed_at: "now() - interval '2 years'" });
      await db.query("select public.issue_repermission($1, 'hash-late')", [id]);
      await db.query(
        "update public.subscribers set repermission_sent_at = now() - interval '31 days' where id = $1",
        [id],
      );
      await db.query("select public.lapse_subscribers()");
      const after = await state(db, id);
      return {
        hash: after.hash,
        archived: after.archived,
        matched: await confirm(db, "hash-late"),
      };
    });
    expect(result).toEqual({ hash: null, archived: true, matched: null });
  });
});

describe("row level security", () => {
  it("no authenticated role may insert into the email tables, and a staff role reads them", async () => {
    const outcomes = await withRollback(async (db) => {
      const admin = await createStaffUser(db, ["admin"]);
      await asRole(db, "authenticated", admin);
      return {
        messages: await attempt(
          db,
          "insert into public.email_messages (template_key, kind) values ('received', 'transactional')",
        ),
        suppressions: await attempt(
          db,
          "insert into public.email_suppressions (email, reason) values ('x@example.test', 'manual')",
        ),
        events: await attempt(
          db,
          "insert into public.email_events (provider_event_id, type, at) values ('msg_rls_test', 'email.sent', now())",
        ),
        read: await attempt(db, "select 1 from public.email_messages limit 1"),
      };
    });
    expect(outcomes).toEqual({
      messages: "42501 permission denied for table email_messages",
      suppressions: "42501 permission denied for table email_suppressions",
      events: "42501 permission denied for table email_events",
      read: "ok",
    });
  });
});
