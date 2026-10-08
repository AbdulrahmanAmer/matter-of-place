// B7: the admin side of the database. Step 1: `write_audit`, the agent key lookups, `staff_can_sign_in`,
// `action_roles` and the agent daily caps (migration `admin_audit`, invariants 3, 18 and 19). Step 4: `start_review`,
// `add_submission_note` and `list_submissions` (migration `admin_submissions_read`). Step 5: the one payments read of
// `getSubmission`. Step 6: the four decision functions and the agent daily cap (migration `admin_submissions_decisions`).
// Step 7: the property functions (migration `admin_properties`). Step 7a: unpublish, takedown and agent preview
// (migration `admin_takedown`).
// Every case but the `getSubmission` one runs in one rolled-back transaction (F22).
import "../fixtures/worker-env";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { asRole, createStaffUser, dbNow, withRollback, type Db } from "../fixtures/db";
import { createInvoice, createSubmission, publishedProperty } from "../fixtures/factories";
import { serviceClient } from "../fixtures/service";
import { stepSchema } from "../../src/domain/automation";
import { marketTimezone } from "../../src/domain/market-time";
import { planEvent } from "../../src/server/automation/plan";
import { getStep } from "../../src/server/jobs/steps";
import type { JsonObject } from "../../src/server/jobs/types";
import { fromRpcError } from "../../src/server/lib/admin-errors";
import { signPreview, verifyPreview } from "../../src/server/lib/preview-token";
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

/** Step 6's functions are on this database (P-328): mop-dev has them once main pushes the migration. */
async function assertStep6(db: Db): Promise<void> {
  const { present } = await one<{ present: boolean }>(
    db,
    `select to_regproc('public.decline_submission') is not null and to_regproc('public.accept_submission') is not null
       and to_regproc('public.assert_agent_daily_cap') is not null as present`,
  );
  expect(present).toBe(true);
}

async function declineReason(db: Db): Promise<string> {
  const { id } = await one<{ id: string }>(
    db,
    "insert into public.decline_reasons (code, label, email_paragraph) values ($1, 'Not a fit', 'We read it closely.') returning id",
    [`test-${randomUUID()}`],
  );
  return id;
}

/** A staff account whose stored kind is `agent` (DB-04). */
async function createAgent(db: Db, roles: string[]): Promise<string> {
  const id = await createStaffUser(db, roles);
  await db.query("update public.user_roles set actor_kind = 'agent' where user_id = $1", [id]);
  return id;
}

/** How many audit rows of `action` and events of `type` request `id` has. */
function written(db: Db, id: string, action: string, type: string) {
  return one<{ audits: number; events: number }>(
    db,
    `select (select count(*)::int from public.audit_log where entity_id = $1 and action = $2) as audits,
       (select count(*)::int from public.events where entity_id = $1 and type = $3) as events`,
    [id, action, type],
  );
}

const marketOf = (state: string) => state.toLowerCase().replace(" ", "-");

const capAt = (db: Db, perDay: number) =>
  db.query(
    "update public.settings set value = jsonb_set(value, '{decisions_per_day}', to_jsonb($1::int)) where key = 'agent_daily_limits'",
    [perDay],
  );

describe("decisions", () => {
  it("decline_submission declines with the reason and the reviewer, one submissions.decline row and one submission.declined event", async () => {
    await withRollback(async (db) => {
      await assertStep6(db);
      const id = await createSubmission(db, {
        state: "Under Review",
        n: 9731,
        base: await dbNow(db),
      });
      const editor = await createStaffUser(db, ["managing_editor"]);
      const reason = await declineReason(db);
      const { event } = await one<{ event: string }>(
        db,
        "select public.decline_submission($1, $2, ' Not this time ', $3, 'human', 'req-dec') as event",
        [id, reason, editor],
      );
      const row = await one<{
        workflow_state: string;
        reviewed_by: string;
        decline_reason_id: string;
        decline_note: string;
        state: string;
      }>(
        db,
        "select workflow_state, reviewed_by, decline_reason_id, decline_note, state::text as state from public.submissions where id = $1",
        [id],
      );
      const { payload } = await one<{ payload: unknown }>(
        db,
        "select payload from public.events where id = $1",
        [event],
      );
      expect({
        row,
        written: await written(db, id, "submissions.decline", "submission.declined"),
        payload,
      }).toEqual({
        row: {
          workflow_state: "Declined",
          reviewed_by: editor,
          decline_reason_id: reason,
          decline_note: "Not this time",
          state: row.state,
        },
        written: { audits: 1, events: 1 },
        payload: {
          submission_id: id,
          decline_reason_id: reason,
          note: "Not this time",
          tier: "Feature",
          market: marketOf(row.state),
        },
      });
    });
  });

  it("accept_submission accepts with the acceptor, one submissions.accept row and one submission.accepted event", async () => {
    await withRollback(async (db) => {
      await assertStep6(db);
      const id = await createSubmission(db, {
        state: "Under Review",
        n: 9732,
        base: await dbNow(db),
      });
      const editor = await createStaffUser(db, ["chief_editor"]);
      await db.query("select public.accept_submission($1, $2, 'human', 'req-acc')", [id, editor]);
      const row = await one<{ workflow_state: string; accepted_by: string; accepted: boolean }>(
        db,
        "select workflow_state, accepted_by, accepted_at is not null as accepted from public.submissions where id = $1",
        [id],
      );
      expect({
        row,
        written: await written(db, id, "submissions.accept", "submission.accepted"),
      }).toEqual({
        row: { workflow_state: "Accepted", accepted_by: editor, accepted: true },
        written: { audits: 1, events: 1 },
      });
    });
  });

  it("a second decline of the same request raises wrong_state and writes nothing more", async () => {
    await withRollback(async (db) => {
      await assertStep6(db);
      const id = await createSubmission(db, {
        state: "Under Review",
        n: 9733,
        base: await dbNow(db),
      });
      const editor = await createStaffUser(db, ["chief_editor"]);
      const reason = await declineReason(db);
      const decline = "select public.decline_submission($1, $2, null, $3, 'human', 'req-dec2')";
      await db.query(decline, [id, reason, editor]);
      const second = await attempt(db, decline, [id, reason, editor]);
      expect({
        second,
        written: await written(db, id, "submissions.decline", "submission.declined"),
      }).toEqual({ second: "P0001 wrong_state", written: { audits: 1, events: 1 } });
    });
  });

  it("with decisions_per_day 2 an agent's third decision raises agent_daily_limit and a human's does not", async () => {
    await withRollback(async (db) => {
      await assertStep6(db);
      const base = await dbNow(db);
      await capAt(db, 2);
      const agent = await createAgent(db, ["managing_editor"]);
      const human = await createStaffUser(db, ["managing_editor"]);
      const outcomes: string[] = [];
      for (const n of [9734, 9735, 9736, 9737, 9738, 9739]) {
        const id = await createSubmission(db, { state: "Under Review", n, base });
        const [actor, kind] = n < 9737 ? [agent, "agent"] : [human, "human"];
        outcomes.push(
          await attempt(db, "select public.accept_submission($1, $2, $3, 'req-cap')", [
            id,
            actor,
            kind,
          ]),
        );
      }
      expect(outcomes).toEqual(["ok", "ok", "P0001 agent_daily_limit", "ok", "ok", "ok"]);
    });
  });

  it("assert_agent_daily_cap refuses an unknown group with invalid_key and counts an agent called as human by its stored kind", async () => {
    await withRollback(async (db) => {
      await assertStep6(db);
      const base = await dbNow(db);
      await capAt(db, 2);
      const agent = await createAgent(db, ["chief_editor"]);
      for (const n of [9740, 9741]) {
        const id = await createSubmission(db, { state: "Under Review", n, base });
        await db.query("select public.accept_submission($1, $2, 'agent', 'req-cap2')", [id, agent]);
      }
      const cap = (group: string) =>
        attempt(db, "select public.assert_agent_daily_cap($1, 'human', $2)", [agent, group]);
      expect({ other: await cap("other"), decisions: await cap("decisions") }).toEqual({
        other: "P0001 invalid_key",
        decisions: "P0001 agent_daily_limit",
      });
    });
  });

  it("request_assets without a note raises invalid_key; with one it writes one submission.awaiting_assets event carrying it", async () => {
    await withRollback(async (db) => {
      await assertStep6(db);
      const id = await createSubmission(db, { state: "Accepted", n: 9742, base: await dbNow(db) });
      const editor = await createStaffUser(db, ["managing_editor"]);
      const ask = "select public.request_assets($1, $2, $3, 'human', 'req-ra') as event";
      const blank = await attempt(db, ask, [id, "  ", editor]);
      const { event } = await one<{ event: string }>(db, ask, [id, "Ten interiors", editor]);
      const { note } = await one<{ note: string }>(
        db,
        "select payload ->> 'note' as note from public.events where id = $1",
        [event],
      );
      const { state } = await one<{ state: string }>(
        db,
        "select workflow_state as state from public.submissions where id = $1",
        [id],
      );
      expect({
        blank,
        state,
        note,
        written: await written(db, id, "submissions.request_assets", "submission.awaiting_assets"),
      }).toEqual({
        blank: "P0001 invalid_key",
        state: "Awaiting Assets",
        note: "Ten interiors",
        written: { audits: 1, events: 1 },
      });
    });
  });

  it("assets_received returns an accepted request to Accepted and an unaccepted one to Under Review, with no event", async () => {
    await withRollback(async (db) => {
      await assertStep6(db);
      const base = await dbNow(db);
      const accepted = await createSubmission(db, { state: "Accepted", n: 9743, base });
      const reviewing = await createSubmission(db, { state: "Under Review", n: 9744, base });
      const editor = await createStaffUser(db, ["chief_editor"]);
      const states: string[] = [];
      for (const id of [accepted, reviewing]) {
        await db.query("select public.request_assets($1, 'Plans', $2, 'human', 'req-ar')", [
          id,
          editor,
        ]);
        const { state } = await one<{ state: string }>(
          db,
          "select public.assets_received($1, $2, 'human', 'req-ar2')::text as state",
          [id, editor],
        );
        states.push(state);
      }
      const { events } = await one<{ events: number }>(
        db,
        "select count(*)::int as events from public.events where entity_id = any ($1::uuid[]) and type <> 'submission.awaiting_assets'",
        [[accepted, reviewing]],
      );
      expect({ states, events }).toEqual({ states: ["Accepted", "Under Review"], events: 0 });
    });
  });
});

// Step 7: properties (migration `admin_properties`, invariants 7, 8 and 21).

/** The case runs only against a database that holds the step's migration (P-328). */
async function assertStep7(db: Db): Promise<void> {
  const { present } = await one<{ present: boolean }>(
    db,
    `select to_regproc('public.create_property_from_submission') is not null
       and to_regproc('public.publish_property') is not null as present`,
  );
  expect(present).toBe(true);
}

/** The markets and region a property needs, when the database has none (as `publishedProperty` does). */
async function markets(db: Db): Promise<void> {
  await db.query(
    `insert into public.markets (slug, name, country, intro)
     values ('california', 'California', 'United States', 'x'), ('new-york', 'New York', 'United States', 'x'),
       ('florida', 'Florida', 'United States', 'x')
     on conflict (slug) do nothing`,
  );
  await db.query(
    `insert into public.regions (slug, market_slug, name, intro) values ('bay-area', 'california', 'Bay Area', 'x')
     on conflict (slug) do nothing`,
  );
}

/** Uploaded photographs of a request, `<submission>/<id>.jpg` as B3 stores them; returns their ids in order. */
async function photos(db: Db, submission: string, count: number): Promise<string[]> {
  const ids: string[] = [];
  for (let n = 0; n < count; n += 1) {
    const id = randomUUID();
    await db.query(
      `insert into public.submission_media (id, submission_id, name, storage_path, sort_order, uploaded_at, mime, bytes)
       values ($1::uuid, $2::uuid, 'photo.jpg', $2::text || '/' || $1::text || '.jpg', $3, now(), 'image/jpeg', 1000)`,
      [id, submission, n],
    );
    ids.push(id);
  }
  return ids;
}

interface Created {
  property_id: string;
  copy_job_id: string | null;
}

async function createFrom(db: Db, submission: string, actor: string): Promise<Created> {
  const { answer } = await one<{ answer: Created }>(
    db,
    "select public.create_property_from_submission($1, $2, 'human', 'req-cp') as answer",
    [submission, actor],
  );
  return answer;
}

/** Fills what a request leaves empty, and six stored photographs with alt text (the first is the hero). */
async function makeComplete(db: Db, property: string): Promise<void> {
  await db.query(
    `update public.properties set region_slug = 'bay-area', neighborhood = 'Fixture Quarter', price = 2500000, beds = 4,
       baths = 3, interior_sq_ft = 3000, lot_acres = 0.5, year_built = 1960, style = 'Modern', place = 'A quiet street.',
       story = array['One.', 'Two.']
     where id = $1`,
    [property],
  );
  await sixPhotographs(db, property);
}

async function sixPhotographs(db: Db, property: string): Promise<void> {
  for (let n = 1; n <= 6; n += 1) {
    await db.query(
      `insert into public.property_media (property_id, media_key, alt, orientation, sort_order)
       values ($1, 'o/fixture/' || $2::int || '-0a1b2c3d.webp', 'Room', 'landscape', $2::int)`,
      [property, n],
    );
  }
}

async function versionOf(db: Db, property: string): Promise<number> {
  const { version } = await one<{ version: number }>(
    db,
    "select version from public.properties where id = $1",
    [property],
  );
  return version;
}

async function toReview(db: Db, property: string, actor: string): Promise<number> {
  const { version } = await one<{ version: number }>(
    db,
    `select public.update_property($1, $2, '{"editorial_state": "review"}', $3, 'human', 'req-rv') as version`,
    [property, await versionOf(db, property), actor],
  );
  return version;
}

/** A request moved on to Scheduled with its paid The Campaign invoice and its campaign row, as B6 leaves it. */
async function scheduledCampaign(db: Db, submission: string, property: string, n: number) {
  const payment = await createInvoice(db, {
    submission,
    status: "paid",
    n,
    product: "The Campaign",
  });
  await db.query("update public.submissions set workflow_state = 'Invoice Issued' where id = $1", [
    submission,
  ]);
  await db.query("update public.submissions set workflow_state = 'Scheduled' where id = $1", [
    submission,
  ]);
  await db.query(
    `insert into public.campaigns (property_id, submission_id, payment_id, package, media_budget)
     values ($1, $2, $3, 'The Campaign', 0)`,
    [property, submission, payment],
  );
}

/** The DETAIL of the error `sql` raises, or `ok`; the transaction stays usable (G-102). */
async function detailOf(db: Db, sql: string, params: unknown[]): Promise<string> {
  await db.query("savepoint detail");
  try {
    await db.query(sql, params);
    await db.query("release savepoint detail");
    return "ok";
  } catch (error) {
    await db.query("rollback to savepoint detail");
    if (error instanceof pg.DatabaseError) return `${error.message}: ${error.detail ?? ""}`;
    throw error;
  }
}

describe("create_property_from_submission", () => {
  it("makes one draft from an accepted Los Angeles request with every missing field null and the slug from the city (G62)", async () => {
    await withRollback(async (db) => {
      await assertStep7(db);
      await markets(db);
      const base = await dbNow(db);
      const editor = await createStaffUser(db, ["managing_editor"]);
      const first = await createSubmission(db, {
        state: "Accepted",
        n: 9900,
        base,
        city: "Los Angeles",
      });
      const second = await createSubmission(db, {
        state: "Accepted",
        n: 9903,
        base,
        city: "Los Angeles",
      });
      const { property_id: id } = await createFrom(db, first, editor);
      const { property_id: other } = await createFrom(db, second, editor);
      const row = await one<Record<string, unknown>>(
        db,
        `select editorial_state, status, source, market_slug, state, title = address as titled, region_slug,
           neighborhood, style, place, slug = 'los-angeles-' || left(id::text, 8) as slugged, version
         from public.properties where id = $1`,
        [id],
      );
      const slugs = await one<{ first: string; second: string }>(
        db,
        `select (select slug from public.properties where id = $1) as first,
           (select slug from public.properties where id = $2) as second`,
        [id, other],
      );
      expect({ row, differs: slugs.first !== slugs.second }).toEqual({
        row: {
          editorial_state: "draft",
          status: "Active",
          source: "Submission",
          market_slug: "california",
          state: "California",
          titled: true,
          region_slug: null,
          neighborhood: null,
          style: null,
          place: null,
          slugged: true,
          version: 1,
        },
        differs: true,
      });
    });
  });

  it("copies three uploaded photographs as staged rows with the same ids and queues one copy job, once", async () => {
    await withRollback(async (db) => {
      await assertStep7(db);
      await markets(db);
      const base = await dbNow(db);
      const editor = await createStaffUser(db, ["visual_editor"]);
      const submission = await createSubmission(db, { state: "Accepted", n: 9906, base });
      const media = await photos(db, submission, 3);
      const first = await createFrom(db, submission, editor);
      const counts = () =>
        one<{ properties: number; jobs: number }>(
          db,
          `select (select count(*)::int from public.properties where submission_id = $1) as properties,
             (select count(*)::int from public.jobs where type = 'copy_submission_media'
                and idempotency_key = 'copy_submission_media:' || $2) as jobs`,
          [submission, first.property_id],
        );
      const before = await counts();
      const second = await createFrom(db, submission, editor);
      const rows = (
        await db.query<{ id: string; staged: boolean; media_key: string | null }>(
          `select id, staging_path = 'staging/' || property_id || '/' || id || '.jpg' as staged, media_key
           from public.property_media where property_id = $1 order by sort_order`,
          [first.property_id],
        )
      ).rows;
      const job = await one<{ id: string; payload: unknown }>(
        db,
        "select id, payload from public.jobs where idempotency_key = 'copy_submission_media:' || $1",
        [first.property_id],
      );
      expect({ rows, before, after: await counts(), second, job }).toEqual({
        rows: media.map((mediaId) => ({ id: mediaId, staged: true, media_key: null })),
        before: { properties: 1, jobs: 1 },
        after: { properties: 1, jobs: 1 },
        second: first,
        job: {
          id: first.copy_job_id,
          payload: { params: {}, data: { property_id: first.property_id } },
        },
      });
    });
  });

  it("links an agent's representative by address, new or existing in another case, and none for an owner (S55)", async () => {
    await withRollback(async (db) => {
      await assertStep7(db);
      await markets(db);
      const base = await dbNow(db);
      const editor = await createStaffUser(db, ["managing_editor"]);
      const { id: known } = await one<{ id: string }>(
        db,
        "insert into public.representatives (name, brokerage, email) values ('Known Agent', 'Coast', 'KNOWN@fixtures.invalid') returning id",
      );
      const linked = async (submission: string) => {
        const { property_id: id } = await createFrom(db, submission, editor);
        return one<{ representative: string | null; email: string | null; owner: boolean }>(
          db,
          `select p.representative_id as representative, r.email, p.presented_by_owner as owner
           from public.properties p left join public.representatives r on r.id = p.representative_id
           where p.id = $1`,
          [id],
        );
      };
      const fresh = await linked(await createSubmission(db, { state: "Accepted", n: 9909, base }));
      const again = await linked(
        await createSubmission(db, {
          state: "Accepted",
          n: 9912,
          base,
          submitter_email: "known@fixtures.invalid",
        }),
      );
      const owner = await linked(
        await createSubmission(db, { state: "Accepted", n: 9915, base, submitter_kind: "owner" }),
      );
      expect({
        fresh: { email: fresh.email, owner: fresh.owner, linked: fresh.representative !== null },
        again: again.representative,
        owner,
      }).toEqual({
        fresh: { email: "fixture+9909@fixtures.invalid", owner: false, linked: true },
        again: known,
        owner: { representative: null, email: null, owner: true },
      });
    });
  });

  it("refuses a request that is not accepted", async () => {
    await withRollback(async (db) => {
      await assertStep7(db);
      const base = await dbNow(db);
      const editor = await createStaffUser(db, ["managing_editor"]);
      const submission = await createSubmission(db, { state: "Under Review", n: 9918, base });
      expect(
        await attempt(
          db,
          "select public.create_property_from_submission($1, $2, 'human', 'req-cp')",
          [submission, editor],
        ),
      ).toBe("P0001 wrong_state");
    });
  });
});

describe("market_timezone", () => {
  it("equals marketTimezone for the three markets", async () => {
    await withRollback(async (db) => {
      await assertStep7(db);
      const rows = (
        await db.query<{ slug: string; zone: string }>(
          "select slug, public.market_timezone(slug) as zone from unnest(array['california', 'new-york', 'florida']) slug",
        )
      ).rows;
      expect(rows).toEqual(rows.map(({ slug }) => ({ slug, zone: marketTimezone(slug) })));
      expect(rows.map((row) => row.zone)).toEqual([
        "America/Los_Angeles",
        "America/New_York",
        "America/New_York",
      ]);
    });
  });
});

describe("update_property", () => {
  it("answers version + 1 at the version read, and version_conflict at a stale one", async () => {
    await withRollback(async (db) => {
      await assertStep7(db);
      await markets(db);
      const base = await dbNow(db);
      const editor = await createStaffUser(db, ["managing_editor"]);
      const { property_id: id } = await createFrom(
        db,
        await createSubmission(db, { state: "Accepted", n: 9921, base }),
        editor,
      );
      const save = (version: number) =>
        attempt(
          db,
          `select public.update_property($1, $2, '{"title": "Edited"}', $3, 'human', 'req-up')`,
          [id, version, editor],
        );
      const fresh = await save(1);
      const stale = await save(1);
      expect({ fresh, stale, version: await versionOf(db, id) }).toEqual({
        fresh: "ok",
        stale: "40001 version_conflict",
        version: 2,
      });
    });
  });
});

describe("publish_property", () => {
  it("names every empty field of a draft made from a request that has a hero and six photographs with alt (G62)", async () => {
    await withRollback(async (db) => {
      await assertStep7(db);
      await markets(db);
      const base = await dbNow(db);
      const editor = await createStaffUser(db, ["chief_editor"]);
      const { property_id: id } = await createFrom(
        db,
        await createSubmission(db, { state: "Accepted", n: 9924, base, city: "Los Angeles" }),
        editor,
      );
      await sixPhotographs(db, id);
      const raised = await detailOf(
        db,
        "select public.publish_property($1, $2, $3, 'human', 'req-pb')",
        [id, await toReview(db, id, editor), editor],
      );
      expect(raised.startsWith("publish_incomplete: Missing: ")).toBe(true);
      for (const field of ["region_slug", "neighborhood", "style", "place"]) {
        expect(raised).toContain(field);
      }
      expect(raised).not.toContain("hero_image");
    });
  });

  it("refuses a property without a hero with publish_incomplete, and a stale version with version_conflict", async () => {
    await withRollback(async (db) => {
      await assertStep7(db);
      await markets(db);
      const base = await dbNow(db);
      const editor = await createStaffUser(db, ["chief_editor"]);
      const { property_id: id } = await createFrom(
        db,
        await createSubmission(db, { state: "Accepted", n: 9927, base }),
        editor,
      );
      await db.query(
        `update public.properties set region_slug = 'bay-area', neighborhood = 'Q', price = 1, beds = 1, baths = 1,
           interior_sq_ft = 1, lot_acres = 1, year_built = 1960, style = 'S', place = 'P' where id = $1`,
        [id],
      );
      const version = await toReview(db, id, editor);
      const publish = (at: number) =>
        detailOf(db, "select public.publish_property($1, $2, $3, 'human', 'req-pb')", [
          id,
          at,
          editor,
        ]);
      expect({ noHero: await publish(version), stale: await publish(version - 1) }).toEqual({
        noHero: "publish_incomplete: Missing: hero_image, six images with alt text",
        stale: "version_conflict: ",
      });
    });
  });

  it("publishes a Scheduled request's property, moves the request to Published, dates The Campaign and emits its tier and market (DL-09)", async () => {
    await withRollback(async (db) => {
      await assertStep7(db);
      await markets(db);
      const base = await dbNow(db);
      const editor = await createStaffUser(db, ["chief_editor"]);
      const submission = await createSubmission(db, { state: "Accepted", n: 9930, base });
      const { property_id: id } = await createFrom(db, submission, editor);
      await makeComplete(db, id);
      await scheduledCampaign(db, submission, id, 9930);
      await db.query("update public.properties set campaign_tier = 'Campaign' where id = $1", [id]);
      const version = await toReview(db, id, editor);
      const { answer } = await one<{ answer: { event_id: string; version: number } }>(
        db,
        "select public.publish_property($1, $2, $3, 'human', 'req-pb') as answer",
        [id, version, editor],
      );
      const after = await one<Record<string, unknown>>(
        db,
        `select p.editorial_state, s.workflow_state, c.ends_on - c.starts_on as days,
           c.starts_on = (now() at time zone 'America/Los_Angeles')::date as today, e.type,
           e.payload - 'slug' as payload
         from public.properties p join public.submissions s on s.id = p.submission_id
         join public.campaigns c on c.property_id = p.id join public.events e on e.id = $2
         where p.id = $1`,
        [id, answer.event_id],
      );
      expect({ after, step: answer.version - version }).toEqual({
        after: {
          editorial_state: "published",
          workflow_state: "Published",
          days: 13,
          today: true,
          type: "property.published",
          payload: {
            property_id: id,
            tier: "Campaign",
            market: "california",
            submission_id: submission,
          },
        },
        step: 2,
      });
    });
  });

  it("republishes after a factual error unpublish without moving the request or the campaign dates (DL-03)", async () => {
    await withRollback(async (db) => {
      await assertStep7(db);
      await markets(db);
      const base = await dbNow(db);
      const editor = await createStaffUser(db, ["chief_editor"]);
      const submission = await createSubmission(db, { state: "Accepted", n: 9933, base });
      const { property_id: id } = await createFrom(db, submission, editor);
      await makeComplete(db, id);
      await scheduledCampaign(db, submission, id, 9933);
      await db.query("select public.publish_property($1, $2, $3, 'human', 'req-pb')", [
        id,
        await toReview(db, id, editor),
        editor,
      ]);
      // What step 7a's unpublish_property writes for a factual error, written here by the test's owner.
      await db.query(
        `update public.properties set editorial_state = 'archived', archived_at = now(), published_at = null,
           unpublish_reason = 'factual_error', unpublished_at = now() where id = $1`,
        [id],
      );
      await db.query(
        "update public.campaigns set starts_on = starts_on - 3, ends_on = ends_on - 3 where property_id = $1",
        [id],
      );
      const dates = () =>
        one<{ starts_on: string; ends_on: string; state: string }>(
          db,
          `select c.starts_on::text, c.ends_on::text, s.workflow_state as state from public.campaigns c
           join public.submissions s on s.id = c.submission_id where c.property_id = $1`,
          [id],
        );
      const before = await dates();
      await db.query(
        `select public.update_property($1, $2, '{"editorial_state": "draft"}', $3, 'human', 'req-dr')`,
        [id, await versionOf(db, id), editor],
      );
      const outcome = await attempt(
        db,
        "select public.publish_property($1, $2, $3, 'human', 'req-pb')",
        [id, await toReview(db, id, editor), editor],
      );
      expect({ outcome, state: before.state, after: await dates() }).toEqual({
        outcome: "ok",
        state: "Published",
        after: before,
      });
    });
  });

  it("an agent's sixth publish in a UTC day raises agent_daily_limit (SEC-11)", async () => {
    await withRollback(async (db) => {
      await assertStep7(db);
      await markets(db);
      const base = await dbNow(db);
      const agent = await createAgent(db, ["chief_editor"]);
      const { property_id: id } = await createFrom(
        db,
        await createSubmission(db, { state: "Accepted", n: 9936, base }),
        await createStaffUser(db, ["chief_editor"]),
      );
      for (let n = 0; n < 5; n += 1) {
        await db.query(
          "select public.write_audit($1, 'agent', 'properties.publish', 'property', $2, null, null, 'req-cap')",
          [agent, id],
        );
      }
      expect(
        await attempt(db, "select public.publish_property($1, $2, $3, 'agent', 'req-pb')", [
          id,
          await versionOf(db, id),
          agent,
        ]),
      ).toBe("P0001 agent_daily_limit");
    });
  });
});

describe("set_ranks, set_features and upsert_representative", () => {
  it("set_ranks swaps a featured rank another property holds, so it stays unique", async () => {
    await withRollback(async (db) => {
      await assertStep7(db);
      const editor = await createStaffUser(db, ["chief_editor"]);
      const a = await publishedProperty(db, { n: 9939, featured_rank: 91 });
      const b = await publishedProperty(db, { n: 9940, featured_rank: 92 });
      await db.query(
        "select public.set_ranks($1, $2, $3, 'human', 'req-rk', p_featured_rank => 92)",
        [a.id, await versionOf(db, a.id), editor],
      );
      const ranks = (
        await db.query<{ id: string; featured_rank: number }>(
          "select id, featured_rank from public.properties where id = any ($1::uuid[]) order by featured_rank",
          [[a.id, b.id]],
        )
      ).rows;
      expect(ranks).toEqual([
        { id: b.id, featured_rank: 91 },
        { id: a.id, featured_rank: 92 },
      ]);
    });
  });

  it("set_features leaves exactly the list in order with one audit row; a duplicate and a stale version are refused", async () => {
    await withRollback(async (db) => {
      await assertStep7(db);
      const editor = await createStaffUser(db, ["visual_editor"]);
      const { id } = await publishedProperty(db, { n: 9942 });
      const set = (version: number, features: string[]) =>
        attempt(db, "select public.set_features($1, $2, $3, $4, 'human', 'req-ft')", [
          id,
          version,
          features,
          editor,
        ]);
      const version = await versionOf(db, id);
      const saved = await set(version, ["Pool", "Garden", "Library"]);
      const duplicate = await set(version + 1, ["Pool", "Pool"]);
      const stale = await set(version, ["Pool"]);
      const rows = (
        await db.query<{ feature: string; sort_order: number }>(
          "select feature, sort_order from public.property_features where property_id = $1 order by sort_order",
          [id],
        )
      ).rows;
      const { audits } = await one<{ audits: number }>(
        db,
        "select count(*)::int as audits from public.audit_log where entity_id = $1 and action = 'properties.update'",
        [id],
      );
      expect({ saved, duplicate, stale, rows, audits }).toEqual({
        saved: "ok",
        duplicate: "P0001 invalid_key",
        stale: "40001 version_conflict",
        rows: [
          { feature: "Pool", sort_order: 0 },
          { feature: "Garden", sort_order: 1 },
          { feature: "Library", sort_order: 2 },
        ],
        audits: 1,
      });
    });
  });

  it("upsert_representative inserts without an id and edits the brokerage with one, an audit row each", async () => {
    await withRollback(async (db) => {
      await assertStep7(db);
      const editor = await createStaffUser(db, ["managing_editor"]);
      const { id } = await one<{ id: string }>(
        db,
        `select public.upsert_representative('{"name": "Ana Agent", "brokerage": "Coast"}', $1, 'human', 'req-rp') as id`,
        [editor],
      );
      await db.query(
        `select public.upsert_representative('{"brokerage": "Coast Two"}', $1, 'human', 'req-rp2', $2)`,
        [editor, id],
      );
      const row = await one<{ name: string; brokerage: string; audits: number }>(
        db,
        `select name, brokerage, (select count(*)::int from public.audit_log
           where entity_id = $1 and action = 'properties.representative_put') as audits
         from public.representatives where id = $1`,
        [id],
      );
      expect(row).toEqual({ name: "Ana Agent", brokerage: "Coast Two", audits: 2 });
    });
  });
});

// Step 7a: unpublish and takedown, the agent's preview link and the slug lock (migration `admin_takedown`, invariants
// 8, 13 and 14, E2E-01).

/** The case runs only against a database that holds the step's migration (P-328). */
async function assertStep7a(db: Db): Promise<void> {
  const { present } = await one<{ present: boolean }>(
    db,
    `select to_regproc('public.unpublish_property') is not null
       and to_regproc('public.issue_agent_preview') is not null
       and to_regproc('public.rotate_preview_nonce') is not null as present`,
  );
  expect(present).toBe(true);
}

const UNPUBLISH = "select public.unpublish_property($1, $2, $3, $4, 'human', 'req-up', $5)";
const ISSUE = "select public.issue_agent_preview($1, $2, $3, 'human', 'req-ap') as answer";

interface Unpublished {
  editorial_state: string;
  published: boolean;
  archived: boolean;
  unpublish_reason: string | null;
  unpublished: boolean;
  taken_down: boolean;
  gone: boolean;
}

/** The row after an unpublish, and whether B2's snapshot lists its slug under `gone`. */
const unpublishedRow = (db: Db, id: string) =>
  one<Unpublished>(
    db,
    `select p.editorial_state, p.published_at is not null as published, p.archived_at is not null as archived,
       p.unpublish_reason, p.unpublished_at is not null as unpublished, p.taken_down_at is not null as taken_down,
       coalesce(public.public_catalog_snapshot() -> 'gone', '[]'::jsonb) ? p.slug as gone
     from public.properties p where p.id = $1`,
    [id],
  );

async function takedownJobs(db: Db, id: string) {
  const { rows } = await db.query<{
    type: string;
    status: string;
    max_attempts: number;
    property_id: string;
  }>(
    `select type, status::text, max_attempts, payload -> 'data' ->> 'property_id' as property_id
     from public.jobs where type = 'takedown_media' and payload -> 'data' ->> 'property_id' = $1::text`,
    [id],
  );
  return rows;
}

/** A social job of `type` for `property`, as B10's steps queue them. */
async function postJob(db: Db, type: string, property: string, status: string): Promise<string> {
  const { id } = await one<{ id: string }>(
    db,
    `insert into public.jobs (type, payload, idempotency_key, status)
     values ($1, jsonb_build_object('params', '{}'::jsonb, 'data', jsonb_build_object('property_id', $2::uuid)),
       $1 || ':' || $2 || ':' || gen_random_uuid(), $3::public.job_status)
     returning id`,
    [type, property, status],
  );
  return id;
}

async function jobStatuses(db: Db, ids: string[]): Promise<string[]> {
  const { rows } = await db.query<{ status: string }>(
    "select status::text from public.jobs where id = any ($1::uuid[]) order by array_position($1::uuid[], id)",
    [ids],
  );
  return rows.map((row) => row.status);
}

async function count(db: Db, sql: string, params: unknown[]): Promise<number> {
  return (await one<{ n: number }>(db, sql, params)).n;
}

describe("unpublish_property", () => {
  it("refuses an empty reason, an unknown one and other without a note with validation, and changes nothing", async () => {
    await withRollback(async (db) => {
      await assertStep7a(db);
      const editor = await createStaffUser(db, ["chief_editor"]);
      const { id } = await publishedProperty(db, { n: 9970 });
      const outcomes = [
        await attempt(db, UNPUBLISH, [id, "", false, editor, null]),
        await attempt(db, UNPUBLISH, [id, null, false, editor, null]),
        await attempt(db, UNPUBLISH, [id, "bored", false, editor, null]),
        await attempt(db, UNPUBLISH, [id, "other", false, editor, " "]),
      ];
      expect({ outcomes, row: (await unpublishedRow(db, id)).editorial_state }).toEqual({
        outcomes: ["22023 validation", "22023 validation", "22023 validation", "22023 validation"],
        row: "published",
      });
    });
  });

  it("an ordinary unpublish archives with its reason, leaves taken_down_at null and the slug out of gone, and queues no takedown_media job", async () => {
    await withRollback(async (db) => {
      await assertStep7a(db);
      const editor = await createStaffUser(db, ["managing_editor"]);
      const { id } = await publishedProperty(db, { n: 9971 });
      await db.query(UNPUBLISH, [id, "factual_error", false, editor, "Wrong year."]);
      expect({ row: await unpublishedRow(db, id), jobs: await takedownJobs(db, id) }).toEqual({
        row: {
          editorial_state: "archived",
          published: false,
          archived: true,
          unpublish_reason: "factual_error",
          unpublished: true,
          taken_down: false,
          gone: false,
        },
        jobs: [],
      });
    });
  });

  it("a takedown sets taken_down_at, lists the slug under gone, cancels the property's queued posts and queues one takedown_media job", async () => {
    await withRollback(async (db) => {
      await assertStep7a(db);
      const editor = await createStaffUser(db, ["chief_editor"]);
      const { id } = await publishedProperty(db, { n: 9972 });
      const { id: other } = await publishedProperty(db, { n: 9973 });
      const posts = [
        await postJob(db, "post_meta", id, "queued"),
        await postJob(db, "post_x", id, "waiting_approval"),
        await postJob(db, "post_linkedin", id, "queued"),
      ];
      const untouched = [
        await postJob(db, "post_x", other, "queued"),
        await postJob(db, "post_meta", id, "running"),
      ];
      await db.query(UNPUBLISH, [id, "rights_takedown", true, editor, null]);
      expect({
        row: await unpublishedRow(db, id),
        posts: await jobStatuses(db, posts),
        untouched: await jobStatuses(db, untouched),
        takedown: await takedownJobs(db, id),
        key: await count(
          db,
          "select count(*)::int as n from public.jobs where idempotency_key = 'takedown_media:' || $1::text",
          [id],
        ),
      }).toEqual({
        row: {
          editorial_state: "archived",
          published: false,
          archived: true,
          unpublish_reason: "rights_takedown",
          unpublished: true,
          taken_down: true,
          gone: true,
        },
        posts: ["cancelled", "cancelled", "cancelled"],
        untouched: ["queued", "running"],
        takedown: [{ type: "takedown_media", status: "queued", max_attempts: 12, property_id: id }],
        key: 1,
      });
    });
  });

  it("an archived property can still be taken down once; a second takedown and a draft are refused with wrong_state", async () => {
    await withRollback(async (db) => {
      await assertStep7a(db);
      const editor = await createStaffUser(db, ["chief_editor"]);
      const { id } = await publishedProperty(db, { n: 9974 });
      const { id: draft } = await publishedProperty(db, {
        n: 9975,
        editorial_state: "draft",
        published_at: null,
      });
      await db.query(UNPUBLISH, [id, "owner_request", false, editor, null]);
      const takedown = await attempt(db, UNPUBLISH, [id, "owner_request", true, editor, null]);
      const again = await attempt(db, UNPUBLISH, [id, "owner_request", true, editor, null]);
      const fromDraft = await attempt(db, UNPUBLISH, [draft, "owner_request", true, editor, null]);
      expect({
        takedown,
        again,
        fromDraft,
        gone: (await unpublishedRow(db, id)).gone,
        jobs: (await takedownJobs(db, id)).length,
      }).toEqual({
        takedown: "ok",
        again: "P0001 wrong_state",
        fromDraft: "P0001 wrong_state",
        gone: true,
        jobs: 1,
      });
    });
  });

  it("writes one property.unpublished event with reason and takedown, and the seeded recipe plans bump_catalog_version and purge_cache for it", async () => {
    await withRollback(async (db) => {
      await assertStep7a(db);
      const editor = await createStaffUser(db, ["chief_editor"]);
      const { id, slug } = await publishedProperty(db, { n: 9976 });
      const { answer } = await one<{ answer: { event_id: string; version: number } }>(
        db,
        "select public.unpublish_property($1, 'owner_request', true, $2, 'human', 'req-up', 'Asked by phone.') as answer",
        [id, editor],
      );
      const events = await db.query<{ id: string; payload: JsonObject }>(
        "select id, payload from public.events where type = 'property.unpublished' and entity_id = $1",
        [id],
      );
      const audit = await one<{ n: number; note: string }>(
        db,
        `select count(*)::int as n, max(note) as note from public.audit_log
         where action = 'properties.unpublish' and entity_id = $1`,
        [id],
      );
      const recipe = await one<{ id: string; enabled: boolean; steps: unknown }>(
        db,
        "select id, enabled, steps from public.automation_recipes where trigger = 'property.unpublished'",
      );
      const event = events.rows[0];
      if (event === undefined) throw new Error("no property.unpublished event");
      const plan = planEvent(
        {
          id: recipe.id,
          trigger: "property.unpublished",
          enabled: recipe.enabled,
          steps: z.array(stepSchema).parse(recipe.steps),
        },
        { id: event.id, payload: event.payload },
        { registry: getStep },
      );
      expect({
        events: events.rows.length,
        answered: event.id === answer.event_id,
        payload: event.payload,
        audit,
        planned: plan.planned.map((job) => job.type),
      }).toEqual({
        events: 1,
        answered: true,
        payload: {
          property_id: id,
          slug,
          market: "california",
          reason: "owner_request",
          takedown: true,
        },
        audit: { n: 1, note: "Asked by phone." },
        planned: ["bump_catalog_version", "purge_cache"],
      });
    });
  });

  it("refuses a visual editor through write_audit with 42501 and leaves the property published", async () => {
    await withRollback(async (db) => {
      await assertStep7a(db);
      const visual = await createStaffUser(db, ["visual_editor"]);
      const { id } = await publishedProperty(db, { n: 9977 });
      expect({
        outcome: await attempt(db, UNPUBLISH, [id, "owner_request", true, visual, null]),
        row: (await unpublishedRow(db, id)).editorial_state,
      }).toEqual({ outcome: "42501 forbidden", row: "published" });
    });
  });
});

/** The admin's answer to a slug change through `update_property`: null when saved, else the mapped error. */
async function renameThroughAdmin(db: Db, id: string, slug: string, actor: string) {
  const version = await versionOf(db, id);
  await db.query("savepoint rename");
  try {
    await db.query(
      "select public.update_property($1, $2, jsonb_build_object('slug', $3::text), $4, 'human', 'req-sl')",
      [id, version, slug, actor],
    );
    await db.query("release savepoint rename");
    return null;
  } catch (error) {
    await db.query("rollback to savepoint rename");
    const mapped = fromRpcError(error);
    return { status: mapped.status, code: mapped.code };
  }
}

describe("the slug lock", () => {
  it("a slug change after publish is 422 slug_locked, and a rename before publish writes one slug_history row", async () => {
    await withRollback(async (db) => {
      await assertStep7a(db);
      const editor = await createStaffUser(db, ["managing_editor"]);
      const published = await publishedProperty(db, { n: 9978 });
      const draft = await publishedProperty(db, {
        n: 9979,
        editorial_state: "draft",
        published_at: null,
      });
      const locked = await renameThroughAdmin(db, published.id, "renamed-after-9978", editor);
      const free = await renameThroughAdmin(db, draft.id, "renamed-before-9979", editor);
      const { rows } = await db.query<{ slug: string }>(
        "select slug from public.slug_history where property_id = $1",
        [draft.id],
      );
      expect({ locked, free, history: rows.map((row) => row.slug) }).toEqual({
        locked: { status: 422, code: "slug_locked" },
        free: null,
        history: [draft.slug],
      });
    });
  });
});

describe("agent preview", () => {
  it("issue_agent_preview moves a draft to agent_review with one audit row and answers its slug and nonce; a published one is wrong_state and a stale version version_conflict", async () => {
    await withRollback(async (db) => {
      await assertStep7a(db);
      const editor = await createStaffUser(db, ["visual_editor"]);
      const draft = await publishedProperty(db, {
        n: 9980,
        editorial_state: "draft",
        published_at: null,
      });
      const published = await publishedProperty(db, { n: 9981 });
      const stale = await attempt(db, ISSUE, [draft.id, 99, editor]);
      const wrong = await attempt(db, ISSUE, [
        published.id,
        await versionOf(db, published.id),
        editor,
      ]);
      const { answer } = await one<{
        answer: { slug: string; preview_nonce: string; version: number };
      }>(db, ISSUE, [draft.id, await versionOf(db, draft.id), editor]);
      const row = await one<{ editorial_state: string; preview_nonce: string; version: number }>(
        db,
        "select editorial_state, preview_nonce, version from public.properties where id = $1",
        [draft.id],
      );
      expect({
        stale,
        wrong,
        answer,
        state: row.editorial_state,
        audits: await count(
          db,
          "select count(*)::int as n from public.audit_log where action = 'properties.agent_preview' and entity_id = $1",
          [draft.id],
        ),
      }).toEqual({
        stale: "40001 version_conflict",
        wrong: "P0001 wrong_state",
        answer: { slug: draft.slug, preview_nonce: row.preview_nonce, version: row.version },
        state: "agent_review",
        audits: 1,
      });
    });
  });

  it("after rotate_preview_nonce the old agent token gets 404, another property's link still verifies, and one properties.revoke_previews audit row holds no nonce", async () => {
    await withRollback(async (db) => {
      await assertStep7a(db);
      const editor = await createStaffUser(db, ["visual_editor"]);
      const key = "admin-db-preview-key";
      const nonceOf = async (id: string) =>
        (
          await one<{ nonce: string }>(
            db,
            "select preview_nonce::text as nonce from public.properties where id = $1",
            [id],
          )
        ).nonce;
      const draftOf = (n: number) =>
        publishedProperty(db, { n, editorial_state: "draft", published_at: null });
      const { id } = await draftOf(9982);
      const { id: other } = await draftOf(9983);
      const { answer } = await one<{ answer: { preview_nonce: string } }>(db, ISSUE, [
        id,
        await versionOf(db, id),
        editor,
      ]);
      const { token } = await signPreview(key, id, answer.preview_nonce, "agent");
      const { token: otherToken } = await signPreview(key, other, await nonceOf(other), "agent");
      const before = await verifyPreview(key, token, await nonceOf(id));
      await db.query("select public.rotate_preview_nonce($1, $2, 'human', 'req-rv')", [id, editor]);
      const audits = await db.query<{ keys: string[] }>(
        `select array(select jsonb_object_keys(before || after)) as keys from public.audit_log
         where action = 'properties.revoke_previews' and entity_id = $1`,
        [id],
      );
      expect({
        before,
        after: await verifyPreview(key, token, await nonceOf(id)),
        other: await verifyPreview(key, otherToken, await nonceOf(other)),
        audits: audits.rows.length,
        nonceAudited: audits.rows.some((row) => row.keys.includes("preview_nonce")),
      }).toEqual({ before: true, after: false, other: true, audits: 1, nonceAudited: false });
    });
  });
});
