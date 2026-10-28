// W7 item 12: `concierge_email_delivery`, the Concierge's email delivery. The newest emails about inquiries (not
// test sends), at most p_limit, each with the inquiry it answers, its template, its state and whether an
// `email.opened` event names it; never the address or the subject. The planted emails are dated in 2100 so they are
// the newest whatever the database holds. Service role only.
import pg from "pg";
import { describe, expect, it } from "vitest";
import { asRole, withRollback, type Db } from "../fixtures/db";

const X = "a7120000-0000-4000-8000-000000000001";
const Y = "a7120000-0000-4000-8000-000000000002";
const Z = "a7120000-0000-4000-8000-000000000003";

const read = (db: Db, limit: number) =>
  db.query<Record<string, unknown>>("select * from public.concierge_email_delivery($1::int)", [
    limit,
  ]);

async function delivery(db: Db, limit: number) {
  await asRole(db, "service_role");
  const rows = await read(db, limit);
  await db.query("reset role");
  return rows;
}

async function email(
  db: Db,
  row: {
    entity: string;
    id: string;
    kind?: string;
    status: string;
    resend: string | null;
    at: string;
  },
): Promise<void> {
  await db.query(
    `insert into public.email_messages
       (template_key, kind, to_email, subject, resend_id, status, entity, entity_id, created_at, sent_at)
     values ('inquiry_ack', $1, 'w712@fixtures.invalid', 'Dear Sam Rivera', $2, $3, $4, $5::uuid,
       $6::timestamptz, $6::timestamptz)`,
    [row.kind ?? "transactional", row.resend, row.status, row.entity, row.id, row.at],
  );
}

async function event(db: Db, id: string, type: string, resend: string): Promise<void> {
  await db.query(
    `insert into public.email_events (provider_event_id, type, resend_email_id, to_email, at)
     values ($1, $2, $3, 'w712@fixtures.invalid', now())`,
    [id, type, resend],
  );
}

async function plant(db: Db): Promise<void> {
  await email(db, {
    entity: "inquiry",
    id: X,
    status: "delivered",
    resend: "w712-x",
    at: "2100-01-05T00:00:00Z",
  });
  await email(db, {
    entity: "inquiry",
    id: Y,
    status: "bounced",
    resend: "w712-y",
    at: "2100-01-04T00:00:00Z",
  });
  await email(db, {
    entity: "submission",
    id: Z,
    status: "delivered",
    resend: "w712-s",
    at: "2100-01-06T00:00:00Z",
  });
  await email(db, {
    entity: "inquiry",
    id: Z,
    kind: "test",
    status: "delivered",
    resend: "w712-t",
    at: "2100-01-07T00:00:00Z",
  });
  await email(db, {
    entity: "inquiry",
    id: Z,
    status: "queued",
    resend: null,
    at: "2100-01-03T00:00:00Z",
  });
  await event(db, "w712-e1", "email.opened", "w712-x");
  await event(db, "w712-e2", "email.opened", "w712-x");
  await event(db, "w712-e3", "email.bounced", "w712-y");
  await event(db, "w712-e4", "email.opened", "w712-s");
}

async function refusal(db: Db): Promise<string> {
  try {
    await read(db, 1);
    return "ok";
  } catch (error) {
    if (!(error instanceof pg.DatabaseError)) throw error;
    return `${error.code ?? ""} ${error.message}`;
  }
}

describe("concierge_email_delivery", () => {
  it("gives the newest emails about inquiries, their state and whether they were opened, nothing else", async () => {
    const { rows, fields } = await withRollback(async (db) => {
      await plant(db);
      return delivery(db, 3);
    });
    expect(fields.map((field) => field.name)).toEqual([
      "inquiry_id",
      "template_key",
      "status",
      "sent_at",
      "opened",
    ]);
    expect(
      rows.map((row) => [row["inquiry_id"], row["template_key"], row["status"], row["opened"]]),
    ).toEqual([
      [X, "inquiry_ack", "delivered", true],
      [Y, "inquiry_ack", "bounced", false],
      [Z, "inquiry_ack", "queued", false],
    ]);
    expect(JSON.stringify(rows)).not.toContain("fixtures.invalid");
    expect(JSON.stringify(rows)).not.toContain("Rivera");
  });

  it("keeps to the limit it is given, and to 50 at most", async () => {
    const counts = await withRollback(async (db) => {
      await plant(db);
      const one = await delivery(db, 1);
      const none = await delivery(db, -1);
      // 50 more emails about inquiries, older than the planted ones: 53 in all, so the cap shows
      await db.query(
        `insert into public.email_messages (template_key, kind, status, entity, entity_id, created_at)
         select 'inquiry_ack', 'transactional', 'sent', 'inquiry', $1::uuid, '2099-12-01'::timestamptz + make_interval(mins => n)
         from generate_series(1, 50) n`,
        [Z],
      );
      const capped = await delivery(db, 100000);
      return [one.rows.length, none.rows.length, capped.rows.length, one.rows[0]?.["inquiry_id"]];
    });
    expect(counts).toEqual([1, 0, 50, X]);
  });

  it("is refused to anon and authenticated", async () => {
    const answers = await withRollback(async (db) => {
      const out: string[] = [];
      for (const role of ["anon", "authenticated"] as const) {
        await db.query("savepoint w712");
        await asRole(db, role);
        out.push(await refusal(db));
        await db.query("rollback to savepoint w712");
        await db.query("reset role");
      }
      return out;
    });
    for (const answer of answers) expect(answer).toMatch(/^42501 permission denied/);
  });

  it("reads the emails about inquiries through their own index, newest first", async () => {
    const found = await withRollback((db) =>
      db.query<{ indexdef: string }>(
        "select indexdef from pg_indexes where schemaname = 'public' and indexname = 'email_messages_inquiry_created_idx'",
      ),
    );
    expect(found.rows.map((row) => row.indexdef)).toEqual([
      "CREATE INDEX email_messages_inquiry_created_idx ON public.email_messages USING btree (created_at DESC, id DESC) WHERE (entity = 'inquiry'::text)",
    ]);
  });
});
