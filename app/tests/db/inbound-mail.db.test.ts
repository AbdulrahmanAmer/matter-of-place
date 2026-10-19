// W8 0h (operator, 2026-10-16): every message of the mailbox is recorded once by inbound_mail_record. A person's email
// wakes its owner through email.received (the alias chooses the owner, never Matter); a service notice becomes the
// runner's line in Matter's thread with the record last; a clean report wakes no one; an id email_replies holds is never
// recorded twice; past the hour's cap a message waits for a person and the team is told once; ops_health names a
// mailbox folder the runner could not read; a person's emails are in their export and anonymised on deletion.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createStaffUser, withRollback, type Db } from "../fixtures/db";

const STATUS = "select public.set_subject_request_status($1, $2, $3, 'human', 'r-subject', $4)";

async function record(
  db: Db,
  over: { id?: string; alias?: string; source?: string; state?: string; line?: string } = {},
): Promise<string | null> {
  const read = await db.query<{ id: string | null }>(
    `select public.inbound_mail_record($1, 'Inbox', 'Dana@Example.net', 'Dana', $2, 'A house', 'Is it available?',
       now(), '{}', $3, $4, $5, '', null, $6) as id`,
    [
      over.id ?? `w8-0h-${randomUUID()}`,
      over.alias ?? "hello",
      over.source ?? "email_inbound",
      over.state ?? "new",
      over.source === "service_notice" ? "Google" : "",
      over.line ?? "",
    ],
  );
  return read.rows[0]?.id ?? null;
}

async function runsOf(db: Db, slug: string) {
  const read = await db.query<{
    cause: string;
    event_id: string | null;
    message_id: string | null;
  }>(
    `select r.cause, r.event_id, r.message_id from public.agent_runs r join public.agents a on a.id = r.agent_id
     where a.slug = $1`,
    [slug],
  );
  return read.rows;
}

describe("inbound mail", () => {
  it("records a person's email once and wakes its owner by alias through email.received", async () => {
    const seen = await withRollback(async (db) => {
      const id = `w8-0h-${randomUUID()}`;
      const first = await record(db, { id });
      const again = await record(db, { id });
      const listing = await record(db, { alias: "listings" });
      const row = await db.query<{ owner_slug: string; state: string; from_email: string }>(
        "select owner_slug, state, from_email from public.inbound_mail where id = $1",
        [first],
      );
      const event = await db.query<{ type: string; entity: string; payload: unknown }>(
        "select type, entity, payload from public.events where entity_id = $1",
        [first],
      );
      const concierge = await runsOf(db, "concierge");
      const editor = await runsOf(db, "editor");
      const matter = await runsOf(db, "matter");
      return {
        first: first !== null,
        again,
        row: row.rows[0],
        event: event.rows[0],
        listing: listing !== null,
        concierge,
        editor,
        matter,
      };
    });
    expect(seen.first).toBe(true);
    expect(seen.again).toBeNull();
    expect(seen.row).toEqual({
      owner_slug: "concierge",
      state: "new",
      from_email: "dana@example.net",
    });
    expect(seen.event).toMatchObject({
      type: "email.received",
      entity: "inbound_mail",
      payload: { alias: "hello" },
    });
    expect(seen.concierge.map((run) => run.cause)).toEqual(["event"]);
    expect(seen.editor.map((run) => run.cause)).toEqual(["event"]);
    expect(seen.matter).toEqual([]);
  });

  it("never records an id email_replies already holds", async () => {
    const seen = await withRollback(async (db) => {
      const id = `w8-0h-${randomUUID()}`;
      await db.query(
        "insert into public.email_replies (provider_id, from_email, received_at) values ($1, 'a@b.c', now())",
        [id],
      );
      return record(db, { id });
    });
    expect(seen).toBeNull();
  });

  it("puts a service notice in Matter's thread as a system line with the record last, and queues Matter once", async () => {
    const seen = await withRollback(async (db) => {
      const id = await record(db, {
        source: "service_notice",
        state: "escalated",
        line: "@matter A notice from Google arrived in the Notification folder.",
      });
      const line = await db.query<{
        thread: string;
        author_kind: string;
        author_id: string;
        body: string;
      }>(
        "select thread, author_kind, author_id, body from public.agent_messages where thread = 'matter'",
      );
      return { id, line: line.rows, matter: await runsOf(db, "matter") };
    });
    expect(seen.line).toEqual([
      {
        thread: "matter",
        author_kind: "system",
        author_id: "mailbox",
        body: `@matter A notice from Google arrived in the Notification folder.\nRecord: service_notice ${seen.id ?? ""}.`,
      },
    ]);
    expect(seen.matter.map((run) => run.cause)).toEqual(["message"]);
  });

  it("records a clean report and spam without waking anyone", async () => {
    const seen = await withRollback(async (db) => {
      await record(db, { source: "service_notice", state: "recorded" });
      await record(db, { state: "spam" });
      const runs = await db.query<{ n: number }>(
        "select count(*)::int as n from public.agent_runs",
      );
      const lines = await db.query<{ n: number }>(
        "select count(*)::int as n from public.agent_messages",
      );
      return { runs: runs.rows[0]?.n, lines: lines.rows[0]?.n };
    });
    expect(seen).toEqual({ runs: 0, lines: 0 });
  });

  it("keeps no body for a service's or our own mail, and the table refuses one", async () => {
    const seen = await withRollback(async (db) => {
      const notice = await record(db, { source: "service_notice", state: "recorded" });
      const ours = await record(db, { source: "our_mail", state: "ignored" });
      const person = await record(db, { state: "spam" });
      const bodies = await db.query<{ source: string; body: string }>(
        "select source, body from public.inbound_mail where id = any ($1::uuid[]) order by source",
        [[notice, ours, person]],
      );
      const refused = await db
        .query(
          `insert into public.inbound_mail (provider_id, folder, received_at, source, body)
           values ('w8-0h-body', 'Inbox', now(), 'service_notice', 'Your code is 123456')`,
        )
        .then(
          () => "inserted",
          (failure: unknown) => (failure instanceof Error ? failure.message : String(failure)),
        );
      return { bodies: bodies.rows, refused };
    });
    expect(seen.bodies).toEqual([
      { source: "email_inbound", body: "Is it available?" },
      { source: "our_mail", body: "" },
      { source: "service_notice", body: "" },
    ]);
    expect(seen.refused).toContain("inbound_mail_body_person_only");
  });

  it("tells the team when a service notice arrives with Matter off, and queues no run", async () => {
    const seen = await withRollback(async (db) => {
      await db.query("update public.agents set state = 'off' where slug = 'matter'");
      await record(db, {
        source: "service_notice",
        state: "escalated",
        line: "@matter A notice from Google arrived in the Notification folder.",
      });
      const lines = await db.query<{ thread: string; body: string }>(
        "select thread, body from public.agent_messages order by created_at",
      );
      return { lines: lines.rows, matter: await runsOf(db, "matter") };
    });
    expect(seen.lines).toEqual([
      {
        thread: "team",
        body: "A service notice arrived and Matter is off to read it: it waits in the admin (Sent emails, Inbound mail).",
      },
    ]);
    expect(seen.matter).toEqual([]);
  });

  it("keeps a person's email past the hour's cap for a person, and tells the team once", async () => {
    const seen = await withRollback(async (db) => {
      for (let index = 0; index < 20; index += 1) await record(db);
      const capped = await record(db);
      await record(db);
      const states = await db.query<{ state: string; n: number }>(
        "select state, count(*)::int as n from public.inbound_mail group by state order by state",
      );
      const told = await db.query<{ body: string }>(
        "select body from public.agent_messages where thread = 'team'",
      );
      const events = await db.query<{ n: number }>("select count(*)::int as n from public.events");
      return {
        capped: capped !== null,
        states: states.rows,
        told: told.rows,
        events: events.rows[0]?.n,
      };
    });
    expect(seen.capped).toBe(true);
    expect(seen.states).toEqual([
      { state: "capped", n: 2 },
      { state: "new", n: 20 },
    ]);
    expect(seen.told).toEqual([
      {
        body: "More than 20 emails from people arrived this hour: the rest wait in the admin (Sent emails, Inbound mail) for a person.",
      },
    ]);
    expect(seen.events).toBe(20);
  });

  it("refuses a notice without the runner's line and a person's state for a service", async () => {
    await expect(
      withRollback((db) => record(db, { source: "service_notice", state: "escalated", line: "" })),
    ).rejects.toThrow("bad_request");
    await expect(
      withRollback((db) => record(db, { source: "service_notice", state: "new" })),
    ).rejects.toThrow("bad_request");
  });

  it("names mail_folders in ops_health while the mailbox check says a folder was not read", async () => {
    const seen = await withRollback(async (db) => {
      const health = async () =>
        (await db.query<{ v: { failing: string[] } }>("select public.ops_health(now()) as v"))
          .rows[0]?.v.failing ?? [];
      await db.query(
        `select public.beat('mail_folders', '{"ok": false, "unread": ["Notification"]}')`,
      );
      const failing = await health();
      await db.query(`select public.beat('mail_folders', '{"ok": true, "unread": []}')`);
      return { failing, after: await health() };
    });
    expect(seen.failing).toContain("mail_folders");
    expect(seen.after).not.toContain("mail_folders");
  });

  it("deletes inbound mail past its year through the retention allow-list", async () => {
    const seen = await withRollback(async (db) => {
      await db.query(
        `insert into public.inbound_mail (provider_id, folder, received_at, source, state)
         values ('w8-0h-old', 'Inbox', now() - interval '400 days', 'email_inbound', 'new'),
                ('w8-0h-new', 'Inbox', now(), 'email_inbound', 'new')`,
      );
      const gone = await db.query<{ n: number }>(
        "select public.retention_delete_rows('inbound_mail') as n",
      );
      const left = await db.query<{ provider_id: string }>(
        "select provider_id from public.inbound_mail",
      );
      return { gone: gone.rows[0]?.n, left: left.rows.map((row) => row.provider_id) };
    });
    expect(seen).toEqual({ gone: 1, left: ["w8-0h-new"] });
  });

  it("exports a person's emails by their address and anonymises them on a deletion request", async () => {
    const seen = await withRollback(async (db) => {
      const admin = await createStaffUser(db, ["admin"]);
      const confirmed = async (kind: string) => {
        const read = await db.query<{ id: string }>(
          "insert into public.subject_requests (email, kind) values ('DANA@example.net', $1) returning id",
          [kind],
        );
        const id = read.rows[0]?.id ?? "";
        await db.query(STATUS, [id, "start_verification", admin, null]);
        await db.query(STATUS, [id, "confirm_identity", admin, "Replied from the address."]);
        return id;
      };
      const mine = await record(db);
      await db.query(
        `insert into public.inbound_mail (provider_id, folder, from_email, from_name, subject, body, received_at, source)
         values ('w8-0h-other', 'Inbox', 'someone@example.org', 'Someone', 'Hi', 'Hello', now(), 'email_inbound')`,
      );
      const exported = await db.query<{ bundle: { inbound_mail?: { id: string }[] } }>(
        "select public.export_subject($1, $2, 'human', 'r-subject') as bundle",
        [await confirmed("access"), admin],
      );
      const deleted = await db.query<{ result: { counts: Record<string, number> } }>(
        "select public.delete_subject($1, $2, 'human', 'r-subject') as result",
        [await confirmed("deletion"), admin],
      );
      const rows = await db.query<{
        provider_id: string;
        anonymised: boolean;
        from_name: string | null;
        subject: string;
        body: string;
      }>(
        `select provider_id, from_email like '%@anonymised.invalid' as anonymised, from_name, subject, body
         from public.inbound_mail where id = $1 or provider_id = 'w8-0h-other'
         order by provider_id = 'w8-0h-other'`,
        [mine],
      );
      return {
        exported: exported.rows[0]?.bundle.inbound_mail?.map((row) => row.id),
        counted: deleted.rows[0]?.result.counts["inbound_mail"],
        rows: rows.rows.map(({ provider_id, ...row }) => ({
          ...row,
          mine: provider_id !== "w8-0h-other",
        })),
      };
    });
    expect(seen.exported).toEqual([expect.any(String)]);
    expect(seen.counted).toBe(1);
    expect(seen.rows).toEqual([
      { anonymised: true, from_name: null, subject: "", body: "", mine: true },
      { anonymised: false, from_name: "Someone", subject: "Hi", body: "Hello", mine: false },
    ]);
  });
});
