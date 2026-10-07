// B7 step 5a, screens 26 and 27 (invariant 23, S55): `people_list`, `person_detail` and `set_contact_notes` of
// migration `admin_people`. Every case runs in one rolled-back transaction (F22).
import { randomUUID } from "node:crypto";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { createStaffUser, withRollback, type Db } from "../fixtures/db";
import { publishedProperty } from "../fixtures/factories";

async function one<T extends object>(db: Db, sql: string, params: unknown[] = []): Promise<T> {
  const row = (await db.query<T>(sql, params)).rows[0];
  if (row === undefined) throw new Error(`no row from: ${sql}`);
  return row;
}

/** Runs `sql` under a savepoint and returns `ok` or the error message; the transaction stays usable (G-102). */
async function attempt(db: Db, sql: string, params: unknown[] = []): Promise<string> {
  await db.query("savepoint attempt");
  try {
    await db.query(sql, params);
    await db.query("release savepoint attempt");
    return "ok";
  } catch (error) {
    await db.query("rollback to savepoint attempt");
    if (error instanceof pg.DatabaseError) return error.message;
    throw error;
  }
}

/** One request through B3's `create_submission`, as the public form sends it; returns its id and contact. */
async function submit(
  db: Db,
  fields: { email: string; address: string; kind: "agent" | "owner"; brokerage?: string },
): Promise<{ id: string; contact_id: string }> {
  const { id } = await one<{ id: string }>(db, "select id from public.create_submission($1)", [
    {
      address: fields.address,
      city: "Berkeley",
      state: "California",
      zip: "94702",
      property_type: "Residence",
      submitter_kind: fields.kind,
      submitter_name: "Pat Person",
      submitter_email: fields.email,
      brokerage: fields.brokerage ?? null,
      story: "x",
      significance: "x",
      package: "The Feature",
      source_path: "/__test",
      rights_version: "test-v1",
      rights_confirmed_at: "2026-10-01T00:00:00Z",
      rights_ip_hash: "test-hash",
      media: [],
    },
  ]);
  return one(db, "select id, contact_id from public.submissions where id = $1", [id]);
}

interface Listed {
  id: string;
  name: string;
  kind: string;
  requests: number;
  accepted: number;
  published: number;
}

/** The `people_list` rows the search finds, in list order. */
async function listed(db: Db, search: string, kind: string | null = null): Promise<Listed[]> {
  return (
    await db.query<Listed>(
      "select id, name, kind, requests, accepted, published from public.people_list(p_search => $1, p_kind => $2)",
      [search, kind],
    )
  ).rows;
}

/** An agent who sent two requests, the second as an owner from the same address in upper case. */
async function twoRequests(db: Db) {
  const token = randomUUID();
  const email = `pat.${token}@example.invalid`;
  const brokerage = `Harbor ${token} Realty`;
  const first = await submit(db, { email, address: "1 Probe Way", kind: "agent", brokerage });
  const second = await submit(db, {
    email: email.toUpperCase(),
    address: "2 Probe Way",
    kind: "owner",
  });
  return { token, email, brokerage, first, second };
}

describe("people_list", () => {
  it("lists two requests from one address in two letter cases as one agent with requests 2", async () => {
    await withRollback(async (db) => {
      const { token, first, second } = await twoRequests(db);
      expect({
        same: second.contact_id === first.contact_id,
        rows: await listed(db, token),
      }).toEqual({
        same: true,
        rows: [
          {
            id: first.contact_id,
            name: "Pat Person",
            kind: "agent",
            requests: 2,
            accepted: 0,
            published: 0,
          },
        ],
      });
    });
  });

  it("counts an accepted request and its published property", async () => {
    await withRollback(async (db) => {
      const { token, first } = await twoRequests(db);
      // `accept_submission` arrives with step 6; B2's gate lets the state move through its own graph.
      await db.query(
        "update public.submissions set workflow_state = 'Under Review' where id = $1",
        [first.id],
      );
      await db.query("update public.submissions set workflow_state = 'Accepted' where id = $1", [
        first.id,
      ]);
      await publishedProperty(db, { n: 9811, submission_id: first.id });
      expect(await listed(db, token)).toMatchObject([{ requests: 2, accepted: 1, published: 1 }]);
    });
  });

  it("finds a person by part of the brokerage, and the owner kind leaves the agent out", async () => {
    await withRollback(async (db) => {
      const { token, first } = await twoRequests(db);
      const part = `HARBOR ${token.toUpperCase()}`;
      expect({
        found: (await listed(db, part)).map((row) => row.id),
        owners: await listed(db, part, "owner"),
      }).toEqual({ found: [first.contact_id], owners: [] });
    });
  });

  it("leaves out an archived contact", async () => {
    await withRollback(async (db) => {
      const { token, first } = await twoRequests(db);
      await db.query("update public.contacts set archived_at = now() where id = $1", [
        first.contact_id,
      ]);
      expect(await listed(db, token)).toEqual([]);
    });
  });

  it("pages in name order after the cursor's name and id", async () => {
    await withRollback(async (db) => {
      const token = randomUUID();
      for (const name of ["Cleo", "Ada", "Bo"]) {
        await db.query("insert into public.contacts (kind, name, email) values ('agent', $1, $2)", [
          `${name} ${token}`,
          `${name.toLowerCase()}.${token}@example.invalid`,
        ]);
      }
      const page = (cursorName: string | null, cursorId: string | null) =>
        db.query<{ name: string; id: string }>(
          "select name, id from public.people_list(p_search => $1, p_limit => 2, p_cursor_name => $2, p_cursor_id => $3)",
          [token, cursorName, cursorId],
        );
      const first = (await page(null, null)).rows;
      const last = first.at(-1);
      const second = (await page(last?.name ?? null, last?.id ?? null)).rows;
      expect([first, second].map((rows) => rows.map((row) => row.name.split(" ")[0]))).toEqual([
        ["Ada", "Bo"],
        ["Cleo"],
      ]);
    });
  });
});

describe("person_detail", () => {
  it("returns the requests, the property, a payment, an email to the address in upper case and an inquiry", async () => {
    await withRollback(async (db) => {
      const { email, first, second } = await twoRequests(db);
      const property = await publishedProperty(db, { n: 9812, submission_id: first.id });
      const { payment } = await one<{ payment: string }>(
        db,
        "insert into public.payments (submission_id, product, amount) values ($1, 'The Feature', 1500) returning id as payment",
        [first.id],
      );
      const { message } = await one<{ message: string }>(
        db,
        `insert into public.email_messages (template_key, kind, to_email, status, sent_at)
         values ('received', 'transactional', $1, 'sent', now()) returning id as message`,
        [email.toUpperCase()],
      );
      const { inquiry } = await one<{ inquiry: string }>(
        db,
        `insert into public.inquiries (intent, subject_kind, subject_slug, subject_title, name, email, message, source_path)
         values ('showing', 'property', $1, 'Probe', 'Iris', 'iris@example.invalid', 'x', '/__test') returning id as inquiry`,
        [property.slug],
      );
      const { detail } = await one<{ detail: Record<string, { id: string }[]> }>(
        db,
        "select public.person_detail($1) as detail",
        [first.contact_id],
      );
      const ids = (list: string) => (detail[list] ?? []).map((item) => item.id);
      expect({
        requests: ids("requests").sort(),
        properties: ids("properties"),
        payments: ids("payments"),
        emails: ids("emails"),
        inquiries: ids("inquiries"),
      }).toEqual({
        requests: [first.id, second.id].sort(),
        properties: [property.id],
        payments: [payment],
        emails: [message],
        inquiries: [inquiry],
      });
    });
  });

  it("raises not_found for an unknown id", async () => {
    await withRollback(async (db) => {
      expect(await attempt(db, "select public.person_detail($1)", [randomUUID()])).toBe(
        "not_found",
      );
    });
  });
});

describe("set_contact_notes", () => {
  it("raises stale for an old version and audits a good save with the notes as pii changed", async () => {
    await withRollback(async (db) => {
      const { first } = await twoRequests(db);
      const editor = await createStaffUser(db, ["visual_editor"]);
      const { version } = await one<{ version: string }>(
        db,
        "select updated_at::text as version from public.contacts where id = $1",
        [first.contact_id],
      );
      const call = (expected: string) =>
        attempt(
          db,
          "select public.set_contact_notes($1, 'Prefers a call.', $2::timestamptz, $3, 'human', 'req-people-db')",
          [first.contact_id, expected, editor],
        );
      const stale = await call("2000-01-01T00:00:00Z");
      const saved = await call(version);
      const audit = await one<{ before: unknown; after: unknown; action: string }>(
        db,
        "select action, before, after from public.audit_log where entity_id = $1 and request_id = 'req-people-db'",
        [first.contact_id],
      );
      expect({
        stale,
        saved,
        notes: (
          await one<{ notes: string }>(db, "select notes from public.contacts where id = $1", [
            first.contact_id,
          ])
        ).notes,
        audit,
      }).toEqual({
        stale: "stale",
        saved: "ok",
        notes: "Prefers a call.",
        audit: {
          action: "people.note",
          before: { id: first.contact_id, notes: { pii: "changed" } },
          after: { id: first.contact_id, notes: { pii: "changed" } },
        },
      });
    });
  });
});
