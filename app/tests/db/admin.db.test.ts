// B7: the admin side of the database. Step 1: `write_audit`, the agent key lookups, `staff_can_sign_in`,
// `action_roles` and the agent daily caps (migration `admin_audit`, invariants 3, 18 and 19). Step 4: `start_review`,
// `add_submission_note` and `list_submissions` (migration `admin_submissions_read`). Step 5: the one payments read of
// `getSubmission`. Every case but that one runs in one rolled-back transaction (F22).
import "../fixtures/worker-env";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { asRole, createStaffUser, dbNow, withRollback, type Db } from "../fixtures/db";
import { createSubmission, publishedProperty } from "../fixtures/factories";
import { serviceClient } from "../fixtures/service";
import { newestPaymentId } from "../../src/server/submissions/service";

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

/** The case runs only against a database that holds the step's migration (P-328). */
async function assertMigrated(db: Db): Promise<void> {
  const { present } = await one<{ present: boolean }>(
    db,
    "select to_regproc('public.write_audit') is not null and to_regclass('public.action_roles') is not null as present",
  );
  expect(present).toBe(true);
}

describe("write_audit", () => {
  it("writes one row with the nine arguments and returns its id", async () => {
    await withRollback(async (db) => {
      await assertMigrated(db);
      const editor = await createStaffUser(db, ["chief_editor"]);
      const entity = randomUUID();
      const before = (
        await one<{ n: number }>(db, "select count(*)::int as n from public.audit_log")
      ).n;
      const { id } = await one<{ id: string }>(
        db,
        `select public.write_audit($1, 'human', 'submissions.decline', 'submission', $2,
           '{"id": "a", "workflow_state": "Under Review"}', '{"id": "a", "workflow_state": "Declined"}',
           'req-admin-db', 'a note') as id`,
        [editor, entity],
      );
      const row = await one<Record<string, unknown>>(
        db,
        "select actor_id, actor_kind, action, entity, entity_id, before, after, request_id, note from public.audit_log where id = $1",
        [id],
      );
      expect(row).toEqual({
        actor_id: editor,
        actor_kind: "human",
        action: "submissions.decline",
        entity: "submission",
        entity_id: entity,
        before: { id: "a", workflow_state: "Under Review" },
        after: { id: "a", workflow_state: "Declined" },
        request_id: "req-admin-db",
        note: "a note",
      });
      expect(
        (await one<{ n: number }>(db, "select count(*)::int as n from public.audit_log")).n,
      ).toBe(before + 1);
    });
  });

  it("writes a system row (null actor) without the actor check", async () => {
    await withRollback(async (db) => {
      await assertMigrated(db);
      const outcome = await attempt(
        db,
        "select public.write_audit(null, null, 'retention.run', 'retention', null, null, '{\"rows\": 3}', null)",
      );
      expect(outcome).toBe("ok");
    });
  });
});

describe("audit_log", () => {
  it("refuses an update, as the service role too", async () => {
    await withRollback(async (db) => {
      await assertMigrated(db);
      const { id } = await one<{ id: string }>(
        db,
        "select public.write_audit(null, null, 'retention.run', 'retention', null, null, null, null) as id",
      );
      await asRole(db, "service_role");
      expect(
        await attempt(db, "update public.audit_log set note = 'changed' where id = $1", [id]),
      ).toMatch(/append_only/);
    });
  });
});

describe("agent keys", () => {
  it("agent_key_by_hash returns a new key's scopes and only its enabled roles", async () => {
    await withRollback(async (db) => {
      await assertMigrated(db);
      const agent = await createStaffUser(db, ["managing_editor", "chief_editor"]);
      await db.query(
        "update public.user_roles set actor_kind = 'agent', disabled_at = case when role = 'chief_editor' then now() end where user_id = $1",
        [agent],
      );
      const hash = `test-${randomUUID()}`;
      const { id } = await one<{ id: string }>(
        db,
        "insert into public.agent_keys (user_id, key_hash, label, scopes) values ($1, $2, 'probe', '{submissions,properties}') returning id",
        [agent, hash],
      );
      const found = await one<Record<string, unknown>>(
        db,
        "select key_id, user_id, scopes, revoked_at, last_used_at, roles::text[] as roles from public.agent_key_by_hash($1)",
        [hash],
      );
      expect(found).toEqual({
        key_id: id,
        user_id: agent,
        scopes: ["submissions", "properties"],
        revoked_at: null,
        last_used_at: null,
        roles: ["managing_editor"],
      });
      expect(
        (await db.query("select * from public.agent_key_by_hash('no-such-hash')")).rowCount,
      ).toBe(0);
    });
  });

  it("two touch_agent_key calls within a minute change last_used_at once", async () => {
    await withRollback(async (db) => {
      await assertMigrated(db);
      const agent = await createStaffUser(db, ["managing_editor"]);
      const { id } = await one<{ id: string }>(
        db,
        "insert into public.agent_keys (user_id, key_hash, label) values ($1, $2, 'probe') returning id",
        [agent, `test-${randomUUID()}`],
      );
      const state = () =>
        one<{ at: Date | null; version: string }>(
          db,
          "select last_used_at as at, ctid::text as version from public.agent_keys where id = $1",
          [id],
        );
      await db.query("select public.touch_agent_key($1)", [id]);
      const first = await state();
      await db.query("select public.touch_agent_key($1)", [id]);
      const second = await state();
      expect(first.at).not.toBeNull();
      // An update writes a new row version even when the value is the same, so an unchanged ctid means no write.
      expect(second).toEqual(first);
      await db.query(
        "update public.agent_keys set last_used_at = now() - interval '2 minutes' where id = $1",
        [id],
      );
      const stale = await state();
      await db.query("select public.touch_agent_key($1)", [id]);
      expect((await state()).version).not.toBe(stale.version);
    });
  });
});

describe("staff_can_sign_in", () => {
  it("is true for an enabled staff address in any case and false for a disabled or unknown one", async () => {
    await withRollback(async (db) => {
      await assertMigrated(db);
      const staff = await createStaffUser(db, ["visual_editor"]);
      const gone = await createStaffUser(db, ["visual_editor"]);
      await db.query("update public.user_roles set disabled_at = now() where user_id = $1", [gone]);
      const email = async (id: string) =>
        (await one<{ email: string }>(db, "select email from auth.users where id = $1", [id]))
          .email;
      const can = async (address: string) =>
        (await one<{ ok: boolean }>(db, "select public.staff_can_sign_in($1) as ok", [address])).ok;
      expect([
        await can((await email(staff)).toUpperCase()),
        await can(await email(gone)),
        await can("nobody@example.invalid"),
      ]).toEqual([true, false, false]);
    });
  });
});

describe("action_roles and the daily caps", () => {
  it("is readable by the service role only", async () => {
    await withRollback(async (db) => {
      await assertMigrated(db);
      const editor = await createStaffUser(db, ["chief_editor"]);
      await db.query("savepoint as_role");
      await asRole(db, "authenticated", editor);
      const refused = await attempt(db, "select * from public.action_roles");
      await db.query("rollback to savepoint as_role");
      await asRole(db, "service_role");
      const { n } = await one<{ n: number }>(
        db,
        "select count(*)::int as n from public.action_roles",
      );
      expect(refused).toMatch(/^42501 permission denied/);
      expect(n).toBeGreaterThan(0);
    });
  });

  it("seeds agent_daily_limits at 25 decisions, 5 publishes and 2000 requests a day", async () => {
    await withRollback(async (db) => {
      await assertMigrated(db);
      const { value } = await one<{ value: unknown }>(
        db,
        "select value from public.settings where key = 'agent_daily_limits'",
      );
      expect(value).toEqual({ decisions_per_day: 25, publish_per_day: 5, requests_per_day: 2000 });
    });
  });

  it("a commercial session cannot update a submission", async () => {
    await withRollback(async (db) => {
      await assertMigrated(db);
      const id = await createSubmission(db, { state: "Submitted", n: 9701, base: await dbNow(db) });
      const city = async () =>
        (await one<{ city: string }>(db, "select city from public.submissions where id = $1", [id]))
          .city;
      const was = await city();
      const commercial = await createStaffUser(db, ["commercial"]);
      await asRole(db, "authenticated", commercial);
      // RLS hides the row from the update (no error, no row) or the grant refuses it (42501); either way nothing moves.
      const outcome = await attempt(
        db,
        "update public.submissions set city = 'Elsewhere' where id = $1",
        [id],
      );
      await db.query("reset role");
      expect({
        refused: outcome === "ok" || outcome.startsWith("42501"),
        city: await city(),
      }).toEqual({
        refused: true,
        city: was,
      });
    });
  });
});

/** Step 4's functions are on this database (P-328): mop-dev has them once main pushes the migration. */
async function assertStep4(db: Db): Promise<void> {
  const { present } = await one<{ present: boolean }>(
    db,
    `select to_regproc('public.start_review') is not null and to_regproc('public.add_submission_note') is not null
       and to_regproc('public.list_submissions') is not null as present`,
  );
  expect(present).toBe(true);
}

describe("start_review", () => {
  it("moves a selection to Under Review with one audit row each, naming the reviewer", async () => {
    await withRollback(async (db) => {
      await assertStep4(db);
      const base = await dbNow(db);
      const ids = [
        await createSubmission(db, { state: "Submitted", n: 9711, base }),
        await createSubmission(db, { state: "Submitted", n: 9712, base }),
      ].sort();
      const editor = await createStaffUser(db, ["managing_editor"]);
      const { started } = await one<{ started: number }>(
        db,
        "select public.start_review($1::uuid[], $2, 'human', 'req-sr') as started",
        [ids, editor],
      );
      const moved = await db.query<{ workflow_state: string; reviewed_by: string; audits: string }>(
        `select s.workflow_state, s.reviewed_by,
           (select count(*) from public.audit_log a
            where a.entity_id = s.id and a.action = 'submissions.start_review' and a.request_id = 'req-sr') as audits
         from public.submissions s where s.id = any ($1::uuid[]) order by s.id`,
        [ids],
      );
      expect({ started, rows: moved.rows }).toEqual({
        started: 2,
        rows: [
          { workflow_state: "Under Review", reviewed_by: editor, audits: "1" },
          { workflow_state: "Under Review", reviewed_by: editor, audits: "1" },
        ],
      });
    });
  });

  it("raises wrong_state and moves none when one request of the selection is already under review", async () => {
    await withRollback(async (db) => {
      await assertStep4(db);
      const base = await dbNow(db);
      const fresh = await createSubmission(db, { state: "Submitted", n: 9713, base });
      const taken = await createSubmission(db, { state: "Under Review", n: 9714, base });
      const editor = await createStaffUser(db, ["chief_editor"]);
      const outcome = await attempt(
        db,
        "select public.start_review($1::uuid[], $2, 'human', 'req-sr2')",
        [[fresh, taken], editor],
      );
      const { state } = await one<{ state: string }>(
        db,
        "select workflow_state as state from public.submissions where id = $1",
        [fresh],
      );
      expect({ outcome, state }).toEqual({ outcome: "P0001 wrong_state", state: "Submitted" });
    });
  });

  it("refuses a visual editor through write_audit with 42501 and moves nothing", async () => {
    await withRollback(async (db) => {
      await assertStep4(db);
      const id = await createSubmission(db, { state: "Submitted", n: 9715, base: await dbNow(db) });
      const visual = await createStaffUser(db, ["visual_editor"]);
      const outcome = await attempt(
        db,
        "select public.start_review(array[$1]::uuid[], $2, 'human', 'req-sr3')",
        [id, visual],
      );
      const { state } = await one<{ state: string }>(
        db,
        "select workflow_state as state from public.submissions where id = $1",
        [id],
      );
      expect({ outcome, state }).toEqual({ outcome: "42501 forbidden", state: "Submitted" });
    });
  });
});

describe("add_submission_note", () => {
  it("appends the note to the request and audits it without its words", async () => {
    await withRollback(async (db) => {
      await assertStep4(db);
      const id = await createSubmission(db, {
        state: "Under Review",
        n: 9716,
        base: await dbNow(db),
      });
      const noter = await createStaffUser(db, ["media_ops"]);
      const text = "Called the listing agent about the light in the hall.";
      const { note } = await one<{ note: { text: string; actor_id: string; actor_kind: string } }>(
        db,
        "select public.add_submission_note($1, $2, $3, 'human', 'req-note') as note",
        [id, `  ${text}  `, noter],
      );
      const stored = await one<{ count: number; last: string }>(
        db,
        `select cardinality(notes) as count, notes[cardinality(notes)] ->> 'text' as last
         from public.submissions where id = $1`,
        [id],
      );
      const audit = await one<{ after: string }>(
        db,
        "select after::text as after from public.audit_log where entity_id = $1 and action = 'submissions.note'",
        [id],
      );
      expect({
        note: [note.text, note.actor_id, note.actor_kind],
        stored,
        auditHasText: audit.after.includes("light in the hall"),
      }).toEqual({
        note: [text, noter, "human"],
        stored: { count: 1, last: text },
        auditHasText: false,
      });
    });
  });

  it("refuses a blank note with validation and an unknown request with not_found", async () => {
    await withRollback(async (db) => {
      await assertStep4(db);
      const id = await createSubmission(db, { state: "Submitted", n: 9717, base: await dbNow(db) });
      const editor = await createStaffUser(db, ["managing_editor"]);
      const blank = await attempt(
        db,
        "select public.add_submission_note($1, '   ', $2, 'human', 'r')",
        [id, editor],
      );
      const unknown = await attempt(
        db,
        "select public.add_submission_note($1, 'A note.', $2, 'human', 'r')",
        [randomUUID(), editor],
      );
      expect([blank, unknown]).toEqual(["P0001 validation", "P0001 not_found"]);
    });
  });
});

describe("list_submissions", () => {
  it("with p_without_property keeps only the accepted request that has no property", async () => {
    await withRollback(async (db) => {
      await assertStep4(db);
      const base = await dbNow(db);
      const withProperty = await createSubmission(db, { state: "Accepted", n: 9721, base });
      const without = await createSubmission(db, { state: "Accepted", n: 9722, base });
      const reviewing = await createSubmission(db, { state: "Under Review", n: 9723, base });
      const property = await publishedProperty(db, { n: 9721, submission_id: withProperty });
      const listed = await db.query<{ id: string; property_id: string | null }>(
        `select id, property_id from public.list_submissions(p_limit => 50, p_without_property => true)
         where id = any ($1::uuid[])`,
        [[withProperty, without, reviewing]],
      );
      const joined = await one<{ property_id: string | null }>(
        db,
        "select property_id from public.submission_list where id = $1",
        [withProperty],
      );
      expect({ listed: listed.rows, joined: joined.property_id }).toEqual({
        listed: [{ id: without, property_id: null }],
        joined: property.id,
      });
    });
  });

  it("pages newest first after a cursor and matches the search as plain text", async () => {
    await withRollback(async (db) => {
      await assertStep4(db);
      const base = await dbNow(db);
      const ids: string[] = [];
      for (const [offset, n] of [9731, 9732, 9733].entries()) {
        ids.push(
          await createSubmission(db, {
            state: "Submitted",
            n,
            base,
            address: `${String(n)} B7 List_Probe Lane`,
            received_at: new Date(base.getTime() - offset * 60_000).toISOString(),
          }),
        );
      }
      const page = async (after: { at: string; id: string } | null) =>
        (
          await db.query<{ id: string; at: string }>(
            `select id, received_at::text as at from public.list_submissions(
               p_limit => 2, p_search => 'List_Probe',
               p_after_received_at => $1::timestamptz, p_after_id => $2::uuid)`,
            [after?.at ?? null, after?.id ?? null],
          )
        ).rows;
      const first = await page(null);
      const last = first.at(-1);
      const second = last === undefined ? [] : await page(last);
      const wildcard = await db.query(
        "select 1 from public.list_submissions(p_limit => 1, p_search => 'B7 List%Probe')",
      );
      expect({
        first: first.map((row) => row.id),
        second: second.map((row) => row.id),
        wildcard: wildcard.rowCount,
      }).toEqual({ first: ids.slice(0, 2), second: ids.slice(2), wildcard: 0 });
    });
  });
});

describe("getSubmission", () => {
  it("reads the newest payment through the service client, and answers null without error for a request with none", async () => {
    expect(await newestPaymentId(serviceClient(), randomUUID())).toBeNull();
  });
});
