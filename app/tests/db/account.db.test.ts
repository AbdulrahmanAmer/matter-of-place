// W6 item 7, ruling H119: the client room's one read. A client is the auth user whose confirmed email is a contact's
// email; `account_room` answers that contact's requests and nothing else, and only the service role may call it.
import { describe, expect, it } from "vitest";
import { asRole, createAuthUser, withRollback, type Db } from "../fixtures/db";

/** An auth user with `email`, confirmed unless `confirmed` is false. */
async function person(db: Db, email: string, confirmed = true): Promise<string> {
  const id = await createAuthUser(db);
  await db.query(
    "update auth.users set email = $2, email_confirmed_at = case when $3 then now() end where id = $1",
    [id, email, confirmed],
  );
  return id;
}

async function contact(db: Db, email: string, archived = false): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.contacts (kind, name, email, archived_at)
     values ('owner', 'Test Owner', $1, case when $2 then now() end) returning id`,
    [email, archived],
  );
  return rows[0]?.id ?? "";
}

async function request(
  db: Db,
  contactId: string,
  address: string,
  receivedAt: string,
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.submissions (
       address, city, state, zip, property_type, submitter_kind, submitter_name, submitter_email, story, significance,
       package, source_path, rights_version, rights_confirmed_at, rights_ip_hash, contact_id, received_at, notes
     ) values (
       $1, 'Berkeley', 'California', '94702', 'Residence', 'owner', 'Test Owner', 'owner@example.test', 'x', 'x',
       'The Feature', '/submit', 'test-v1', now(), 'test-hash', $2, $3, array['{"text": "staff only"}'::jsonb]
     ) returning id`,
    [address, contactId, receivedAt],
  );
  return rows[0]?.id ?? "";
}

async function room(db: Db, user: string): Promise<unknown> {
  // Times print in the session's zone; PostgREST sessions are UTC, and so is this one.
  await db.query("set local time zone 'UTC'");
  const { rows } = await db.query<{ room: unknown }>("select public.account_room($1) as room", [
    user,
  ]);
  return rows[0]?.room;
}

interface Room {
  name: string;
  requests: { id: string; address: string }[];
}

const isRoom = (value: unknown): value is Room =>
  typeof value === "object" && value !== null && "requests" in value;

const requestIds = (value: unknown): string[] =>
  isRoom(value) ? value.requests.map((entry) => entry.id) : [];

describe("account_room", () => {
  it("lists the client's own requests by address and state, newest first, and no staff field", async () => {
    const { answer, older, newer } = await withRollback(async (db) => {
      const user = await person(db, "test-account-a@example.test");
      const own = await contact(db, "test-account-a@example.test");
      const older = await request(db, own, "1 Older Way", "2026-10-01T10:00:00Z");
      const newer = await request(db, own, "2 Newer Way", "2026-10-02T10:00:00Z");
      return { answer: await room(db, user), older, newer };
    });
    expect(answer).toEqual({
      name: "Test Owner",
      email: "test-account-a@example.test",
      requests: [
        {
          id: newer,
          address: "2 Newer Way",
          city: "Berkeley",
          state: "California",
          workflow_state: "Submitted",
          received_at: "2026-10-02T10:00:00+00:00",
        },
        {
          id: older,
          address: "1 Older Way",
          city: "Berkeley",
          state: "California",
          workflow_state: "Submitted",
          received_at: "2026-10-01T10:00:00+00:00",
        },
      ],
    });
  });

  it("a client cannot read another client's request, through the room or the table", async () => {
    const seen = await withRollback(async (db) => {
      const a = await person(db, "test-account-a@example.test");
      const ownContact = await contact(db, "test-account-a@example.test");
      const otherContact = await contact(db, "test-account-b@example.test");
      const own = await request(db, ownContact, "1 Own Way", "2026-10-01T10:00:00Z");
      const others = await request(db, otherContact, "9 Other Way", "2026-10-03T10:00:00Z");
      const viaRoom = requestIds(await room(db, a));
      await asRole(db, "authenticated", a);
      const viaTable = await db.query<{ id: string }>(
        "select id from public.submissions where id = any ($1::uuid[])",
        [[own, others]],
      );
      return { viaRoom, viaTable: viaTable.rows, own, others };
    });
    expect({ viaRoom: seen.viaRoom, viaTable: seen.viaTable }).toEqual({
      viaRoom: [seen.own],
      viaTable: [],
    });
  });

  it("a signed-in person calls neither the room nor the mapping", async () => {
    const codes = await withRollback(async (db) => {
      const a = await person(db, "test-account-a@example.test");
      await contact(db, "test-account-a@example.test");
      await asRole(db, "authenticated", a);
      const attempt = async (sql: string): Promise<string> => {
        await db.query("savepoint attempt");
        try {
          await db.query(sql, [a]);
          return "ran";
        } catch (error) {
          return error instanceof Error && "code" in error ? String(error.code) : "error";
        } finally {
          await db.query("rollback to savepoint attempt");
        }
      };
      return {
        room: await attempt("select public.account_room($1)"),
        mapping: await attempt("select app.contact_of($1)"),
      };
    });
    expect(codes).toEqual({ room: "42501", mapping: "42501" });
  });

  it("a session with no matching contact has no room", async () => {
    const answer = await withRollback(async (db) => {
      const user = await person(db, "test-account-nobody@example.test");
      // Another person is a client, so a mapping that ignored whose session it is would find their room.
      await person(db, "test-account-someone-else@example.test");
      await contact(db, "test-account-someone-else@example.test");
      return room(db, user);
    });
    expect(answer).toBeNull();
  });

  it("an unconfirmed email has no room", async () => {
    const answer = await withRollback(async (db) => {
      const user = await person(db, "test-account-a@example.test", false);
      await contact(db, "test-account-a@example.test");
      return room(db, user);
    });
    expect(answer).toBeNull();
  });

  it("an archived contact has no room", async () => {
    const answer = await withRollback(async (db) => {
      const user = await person(db, "test-account-a@example.test");
      await contact(db, "test-account-a@example.test", true);
      return room(db, user);
    });
    expect(answer).toBeNull();
  });

  it("the email matches ignoring case", async () => {
    const answer = await withRollback(async (db) => {
      const user = await person(db, "Test-Account-A@Example.test");
      const own = await contact(db, "test-account-a@example.test");
      await request(db, own, "1 Own Way", "2026-10-01T10:00:00Z");
      return room(db, user);
    });
    expect(isRoom(answer) ? answer.requests.map((entry) => entry.address) : []).toEqual([
      "1 Own Way",
    ]);
  });

  // Ruling H119 (5): a public request made with someone's address joins their room (added), but the name the room
  // greets them with stays the one first recorded; what the submitter typed stays on the request.
  it("keeps the name of an existing contact when a public request uses their email", async () => {
    const seen = await withRollback(async (db) => {
      const user = await person(db, "test-account-a@example.test");
      await contact(db, "test-account-a@example.test");
      await db.query("select id from public.create_submission($1)", [
        {
          address: "7 Outsider Way",
          city: "Berkeley",
          state: "California",
          zip: "94702",
          property_type: "Residence",
          submitter_kind: "owner",
          submitter_name: "Somebody Else",
          submitter_email: "Test-Account-A@Example.test",
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
      const typed = await db.query<{ submitter_name: string }>(
        "select submitter_name from public.submissions where address = '7 Outsider Way'",
      );
      return { answer: await room(db, user), typed: typed.rows[0]?.submitter_name };
    });
    expect({
      name: isRoom(seen.answer) ? seen.answer.name : null,
      addresses: isRoom(seen.answer) ? seen.answer.requests.map((entry) => entry.address) : [],
      typed: seen.typed,
    }).toEqual({ name: "Test Owner", addresses: ["7 Outsider Way"], typed: "Somebody Else" });
  });
});

// Ruling H119 (4): a sign-in link is queued only for an address that is a contact's, never archived, whatever its
// letter case; only the service role asks, since the answer says who has sent us a property.
describe("account_can_sign_in", () => {
  async function canSignIn(db: Db, email: string): Promise<unknown> {
    const { rows } = await db.query<{ ok: unknown }>(
      "select public.account_can_sign_in($1) as ok",
      [email],
    );
    return rows[0]?.ok;
  }

  it("is true for a contact's address, ignoring letter case", async () => {
    const answers = await withRollback(async (db) => {
      await contact(db, "test-account-a@example.test");
      return [
        await canSignIn(db, "test-account-a@example.test"),
        await canSignIn(db, "Test-Account-A@Example.TEST"),
      ];
    });
    expect(answers).toEqual([true, true]);
  });

  it("is false for an archived contact and for an address that is no contact's", async () => {
    const answers = await withRollback(async (db) => {
      await contact(db, "test-account-a@example.test", true);
      // A live contact of another address, so a lookup that ignored the address would find one.
      await contact(db, "test-account-b@example.test");
      return [
        await canSignIn(db, "test-account-a@example.test"),
        await canSignIn(db, "test-account-nobody@example.test"),
      ];
    });
    expect(answers).toEqual([false, false]);
  });

  it("refuses anon and a signed-in person", async () => {
    const codes = await withRollback(async (db) => {
      const a = await person(db, "test-account-a@example.test");
      await contact(db, "test-account-a@example.test");
      const attempt = async (role: "anon" | "authenticated"): Promise<string> => {
        await db.query("savepoint attempt");
        try {
          await asRole(db, role, role === "anon" ? undefined : a);
          await db.query("select public.account_can_sign_in($1)", ["test-account-a@example.test"]);
          return "ran";
        } catch (error) {
          return error instanceof Error && "code" in error ? String(error.code) : "error";
        } finally {
          await db.query("rollback to savepoint attempt");
        }
      };
      return { anon: await attempt("anon"), authenticated: await attempt("authenticated") };
    });
    expect(codes).toEqual({ anon: "42501", authenticated: "42501" });
  });
});

// W6 item 7, second review: the Team invite finds the auth user of an address that already has an account. Only the
// service role reads it; the Auth API's `generateLink` is never used, since it mints a live sign-in token.
describe("user_id_by_email", () => {
  it("finds the user of an address ignoring case, and answers null for an address nobody holds", async () => {
    const seen = await withRollback(async (db) => {
      const id = await person(db, "test-invite-a@example.test", false);
      const answer = async (email: string) =>
        (await db.query<{ id: string | null }>("select public.user_id_by_email($1) as id", [email]))
          .rows[0]?.id;
      return {
        id,
        exact: await answer("test-invite-a@example.test"),
        shouted: await answer("TEST-Invite-A@Example.Test"),
        nobody: await answer("test-invite-nobody@example.test"),
      };
    });
    expect(seen).toEqual({ id: seen.id, exact: seen.id, shouted: seen.id, nobody: null });
  });

  it("refuses anon and a signed-in person", async () => {
    const codes = await withRollback(async (db) => {
      const a = await person(db, "test-invite-a@example.test");
      const attempt = async (role: "anon" | "authenticated"): Promise<string> => {
        await db.query("savepoint attempt");
        try {
          await asRole(db, role, role === "anon" ? undefined : a);
          await db.query("select public.user_id_by_email($1)", ["test-invite-a@example.test"]);
          return "ran";
        } catch (error) {
          return error instanceof Error && "code" in error ? String(error.code) : "error";
        } finally {
          await db.query("rollback to savepoint attempt");
        }
      };
      return { anon: await attempt("anon"), authenticated: await attempt("authenticated") };
    });
    expect(codes).toEqual({ anon: "42501", authenticated: "42501" });
  });
});
