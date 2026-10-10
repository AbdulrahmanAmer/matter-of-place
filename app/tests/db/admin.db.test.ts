// B7: the admin side of the database. Step 1: `write_audit`, the agent key lookups, `staff_can_sign_in`,
// `action_roles` and the agent daily caps (migration `admin_audit`, invariants 3, 18 and 19). Step 4: `start_review`,
// `add_submission_note` and `list_submissions` (migration `admin_submissions_read`). Step 5: the one payments read of
// `getSubmission`. Step 6: the four decision functions and the agent daily cap (migration `admin_submissions_decisions`).
// Step 7: the property functions (migration `admin_properties`). Step 7a: unpublish, takedown and agent preview
// (migration `admin_takedown`). Step 8: the media functions and the one render job per property (migration
// `admin_media`). Step 11: assign, forward, close and the list of inquiries (migration `admin_inquiries`).
// Step 12: save, publish and unpublish of stories and their list (migration `admin_stories`).
// Step 13: update_market and set_market_coming_soon (migration `admin_markets`). Step 14: roles, the last admin,
// agent keys, `team_users` and the agent daily caps through `put_setting` (migration `admin_team`).
// Step 15: `put_setting` for its three keys and the audit list read (migration `admin_settings`). Step 15a: the
// redirect writes and the four data-request functions (migrations `admin_redirects` and `admin_privacy`).
// Every case but the `getSubmission` one runs in one rolled-back transaction (F22).
import "../fixtures/worker-env";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  asRole,
  createAuthUser,
  createStaffUser,
  dbNow,
  withRollback,
  type Db,
} from "../fixtures/db";
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

  it("a takedown sets taken_down_at, lists the slug under gone, takes a new preview_nonce, cancels the property's queued posts and queues one takedown_media job", async () => {
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
      const NONCE = "select preview_nonce::text as nonce from public.properties where id = $1";
      const before = await one<{ nonce: string }>(db, NONCE, [id]);
      await db.query(UNPUBLISH, [id, "rights_takedown", true, editor, null]);
      expect({
        nonceRotated: (await one<{ nonce: string }>(db, NONCE, [id])).nonce !== before.nonce,
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
        nonceRotated: true,
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

  it("after rotate_preview_nonce the old agent token no longer verifies, another property's link still verifies, and one properties.revoke_previews audit row holds no nonce", async () => {
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

/** The case runs only against a database that holds step 8's migration (P-328). */
async function assertStep8(db: Db): Promise<void> {
  const { present } = await one<{ present: boolean }>(
    db,
    `select to_regproc('public.attach_media') is not null
       and to_regproc('public.request_property_render') is not null as present`,
  );
  expect(present).toBe(true);
}

const ATTACH = "select public.attach_media($1, $2, $3, $4, 'human', 'req-am') as answer";
const REPLACE = "select public.replace_media($1, $2, $3, 'human', 'req-rm') as answer";
const DELETE_MEDIA = "select public.delete_media($1, $2, 'human', 'req-dm') as path";
const REORDER = "select public.reorder_media($1, $2::uuid[], $3, 'human', 'req-ro')";

/** Attaches a new photograph staged as `createStagingUpload` names it; returns its id. */
async function attach(db: Db, property: string, actor: string): Promise<string> {
  const id = randomUUID();
  await db.query(ATTACH, [id, property, `staging/${property}/${id}.jpg`, actor]);
  return id;
}

interface RenderJob {
  id: string;
  heavy: boolean;
  max_attempts: number;
  key: string;
  property: string;
  slug: string;
  seconds: number;
}

/** The queued render_variants jobs of a property, with their run_after as seconds after the transaction's now(). */
async function renderJobs(db: Db, property: string): Promise<RenderJob[]> {
  return (
    await db.query<RenderJob>(
      `select id, heavy, max_attempts, idempotency_key as key, payload -> 'data' ->> 'property_id' as property,
         payload -> 'data' ->> 'slug' as slug, extract(epoch from run_after - now())::float8 as seconds
       from public.jobs
       where type = 'render_variants' and status = 'queued' and payload -> 'data' ->> 'property_id' = $1`,
      [property],
    )
  ).rows;
}

/** A stored photograph (a render has run) that an earlier job claimed. */
async function storedPhoto(db: Db, property: string): Promise<string> {
  const { id } = await one<{ id: string }>(
    db,
    `insert into public.property_media (property_id, media_key, alt, orientation, sort_order, render_job_id)
     values ($1, 'o/fixture/1-0a1b2c3d.webp', 'The hall', 'landscape', 3, gen_random_uuid()) returning id`,
    [property],
  );
  return id;
}

const draftOrPublished = (db: Db, n: number, state: "draft" | "published") =>
  publishedProperty(
    db,
    state === "draft" ? { n, editorial_state: "draft", published_at: null } : { n },
  );

interface Replaced {
  answer: { previous_staging_path: string | null; render_job_id: string };
}

describe("media", () => {
  const attachQueuesOne = (n: number, state: "draft" | "published") =>
    withRollback(async (db) => {
      await assertStep8(db);
      const editor = await createStaffUser(db, ["visual_editor"]);
      const property = await draftOrPublished(db, n, state);
      // A live page keeps a stored hero (B2's publish gate), so the new photograph comes after six stored ones.
      await sixPhotographs(db, property.id);
      const id = await attach(db, property.id, editor);
      const row = await one<Record<string, unknown>>(
        db,
        "select staging_path, media_key, orientation, variants, sort_order from public.property_media where id = $1",
        [id],
      );
      const jobs = await renderJobs(db, property.id);
      return {
        actual: {
          row,
          jobs: jobs.map((job) => ({
            heavy: job.heavy,
            max_attempts: job.max_attempts,
            keyed: job.key.startsWith(`render_variants:${property.id}:`),
            property: job.property,
            slug: job.slug,
            about90: job.seconds >= 89 && job.seconds <= 91,
          })),
        },
        wanted: {
          row: {
            staging_path: `staging/${property.id}/${id}.jpg`,
            media_key: null,
            orientation: null,
            variants: {},
            sort_order: 7,
          },
          jobs: [
            {
              heavy: true,
              max_attempts: 12,
              keyed: true,
              property: property.id,
              slug: property.slug,
              about90: true,
            },
          ],
        },
      };
    });

  it("attach_media on a draft stages a row with no key and no orientation, and queues one render_variants job (G63, G66)", async () => {
    const { actual, wanted } = await attachQueuesOne(9984, "draft");
    expect(actual).toEqual(wanted);
  });

  it("attach_media on a published property queues one render_variants job too (G66)", async () => {
    const { actual, wanted } = await attachQueuesOne(9985, "published");
    expect(actual).toEqual(wanted);
  });

  it("40 attach_media calls in a row on one property leave exactly one queued render_variants job (coalesce, E2E-08)", async () => {
    await withRollback(async (db) => {
      await assertStep8(db);
      const editor = await createStaffUser(db, ["managing_editor"]);
      const { id } = await draftOrPublished(db, 9986, "draft");
      for (let n = 0; n < 40; n += 1) await attach(db, id, editor);
      const positions = await db.query<{ sort_order: number }>(
        "select sort_order from public.property_media where property_id = $1 order by sort_order",
        [id],
      );
      expect({
        jobs: (await renderJobs(db, id)).length,
        positions: positions.rows.map((row) => row.sort_order),
      }).toEqual({ jobs: 1, positions: Array.from({ length: 40 }, (_, n) => n) });
    });
  });

  it("attach_media refuses the path of another photograph with invalid_image and writes nothing", async () => {
    await withRollback(async (db) => {
      await assertStep8(db);
      const editor = await createStaffUser(db, ["visual_editor"]);
      const { id } = await draftOrPublished(db, 9987, "draft");
      const answer = await attempt(db, ATTACH, [
        randomUUID(),
        id,
        `staging/${id}/${randomUUID()}.jpg`,
        editor,
      ]);
      expect({
        answer,
        rows: await count(
          db,
          "select count(*)::int as n from public.property_media where property_id = $1",
          [id],
        ),
      }).toEqual({ answer: "22023 invalid_image", rows: 0 });
    });
  });

  const replaceKeeps = (n: number, state: "draft" | "published") =>
    withRollback(async (db) => {
      await assertStep8(db);
      const editor = await createStaffUser(db, ["chief_editor"]);
      const property = await draftOrPublished(db, n, state);
      const id = await storedPhoto(db, property.id);
      const firstPath = `staging/${property.id}/${id}.0a1b2c3d.jpg`;
      const secondPath = `staging/${property.id}/${id}.4e5f6a7b.jpg`;
      const first = await one<Replaced>(db, REPLACE, [id, firstPath, editor]);
      const row = await one<Record<string, unknown>>(
        db,
        "select sort_order, alt, media_key, staging_path, render_job_id from public.property_media where id = $1",
        [id],
      );
      const second = await one<Replaced>(db, REPLACE, [id, secondPath, editor]);
      const jobs = await renderJobs(db, property.id);
      return {
        actual: {
          row,
          audits: await count(
            db,
            "select count(*)::int as n from public.audit_log where action = 'media.replace' and entity_id = $1",
            [id],
          ),
          previous: [first.answer.previous_staging_path, second.answer.previous_staging_path],
          jobs: jobs.map((job) => job.id),
          reused: second.answer.render_job_id === first.answer.render_job_id,
        },
        wanted: {
          row: {
            sort_order: 3,
            alt: "The hall",
            media_key: "o/fixture/1-0a1b2c3d.webp",
            staging_path: firstPath,
            render_job_id: null,
          },
          audits: 2,
          previous: [null, firstPath],
          jobs: [first.answer.render_job_id],
          reused: true,
        },
      };
    });

  it("replace_media on a draft keeps order, alt and key, stages the new path, audits media.replace and queues one render a second replace reuses", async () => {
    const { actual, wanted } = await replaceKeeps(9988, "draft");
    expect(actual).toEqual(wanted);
  });

  it("replace_media on a published property does the same with one queued render (G66)", async () => {
    const { actual, wanted } = await replaceKeeps(9989, "published");
    expect(actual).toEqual(wanted);
  });

  it("a render storing the hero's key moves hero_image and not version, so update_property at the version read before succeeds (DB-16)", async () => {
    await withRollback(async (db) => {
      await assertStep8(db);
      const editor = await createStaffUser(db, ["managing_editor"]);
      const { id } = await publishedProperty(db, {
        n: 9990,
        editorial_state: "draft",
        published_at: null,
        hero_image: null,
      });
      const media = await attach(db, id, editor);
      const before = await versionOf(db, id);
      await db.query(
        `update public.property_media set media_key = 'o/fixture/1-0a1b2c3d.webp', staging_path = null,
           variants = '{"hero": {"w": 1600, "h": 1067}}' where id = $1`,
        [media],
      );
      const hero = await one<{ hero_image: string | null }>(
        db,
        "select hero_image from public.properties where id = $1",
        [id],
      );
      const saved = await attempt(
        db,
        `select public.update_property($1, $2, '{"title": "Edited"}', $3, 'human', 'req-db16')`,
        [id, before, editor],
      );
      expect({ hero: hero.hero_image, saved }).toEqual({
        hero: "o/fixture/1-0a1b2c3d.webp",
        saved: "ok",
      });
    });
  });

  it("delete_media succeeds while assets is absent, and is refused on a published property and for a photograph an asset uses", async () => {
    await withRollback(async (db) => {
      await assertStep8(db);
      const editor = await createStaffUser(db, ["visual_editor"]);
      const { id: draft } = await draftOrPublished(db, 9991, "draft");
      const published = await draftOrPublished(db, 9992, "published");
      const used = await storedPhoto(db, draft);
      await db.query(
        `insert into public.assets (property_id, kind, files)
         values ($1, 'cover', '[{"media_key": "o/fixture/1-0a1b2c3d.webp", "role": "cover"}]')`,
        [draft],
      );
      const live = await storedPhoto(db, published.id);
      const refusedInUse = await attempt(db, DELETE_MEDIA, [used, editor]);
      const refusedLive = await attempt(db, DELETE_MEDIA, [live, editor]);
      const staged = await attach(db, draft, editor);
      // B9's table hidden for the rest of the rolled-back transaction: the function must not need it.
      await db.query("alter table public.assets rename to assets_hidden_for_test");
      const { path } = await one<{ path: string | null }>(db, DELETE_MEDIA, [staged, editor]);
      expect({
        refusedInUse,
        refusedLive,
        path,
        audits: await count(
          db,
          "select count(*)::int as n from public.audit_log where action = 'media.delete' and entity_id = $1",
          [staged],
        ),
      }).toEqual({
        refusedInUse: "P0001 media_in_use",
        refusedLive: "P0001 wrong_state",
        path: `staging/${draft}/${staged}.jpg`,
        audits: 1,
      });
    });
  });

  it("reorder_media puts the named order in place and refuses an order that leaves a photograph out", async () => {
    await withRollback(async (db) => {
      await assertStep8(db);
      const editor = await createStaffUser(db, ["visual_editor"]);
      const { id } = await draftOrPublished(db, 9993, "draft");
      const first = await attach(db, id, editor);
      const second = await attach(db, id, editor);
      const partial = await attempt(db, REORDER, [id, [second], editor]);
      await db.query(REORDER, [id, [second, first], editor]);
      const order = await db.query<{ id: string }>(
        "select id from public.property_media where property_id = $1 order by sort_order",
        [id],
      );
      expect({ partial, order: order.rows.map((row) => row.id) }).toEqual({
        partial: "22023 reorder_mismatch",
        order: [second, first],
      });
    });
  });
});

/** The case runs only against a database that holds step 11's migration (P-328). */
async function assertStep11(db: Db): Promise<void> {
  const { present } = await one<{ present: boolean }>(
    db,
    "select to_regproc('public.forward_inquiry') is not null and to_regproc('public.list_inquiries') is not null as present",
  );
  expect(present).toBe(true);
}

async function createInquiry(db: Db, received: string): Promise<string> {
  const { id } = await one<{ id: string }>(
    db,
    `insert into public.inquiries (intent, name, email, message, source_path, received_at)
     values ('showing', 'Fixture', 'inquiry@fixtures.invalid', 'Hello', '/property/fixture', $1::timestamptz)
     returning id`,
    [received],
  );
  return id;
}

const ASSIGN = "select public.assign_inquiry($1, $2, $3, 'human', 'req-inquiries') as state";
const FORWARD = "select public.forward_inquiry($1, $2, 'human', 'req-inquiries') as job";
const CLOSE = "select public.close_inquiry($1, $2, 'human', 'req-inquiries') as state";

async function stateOf(db: Db, id: string): Promise<string> {
  return (
    await one<{ state: string }>(db, "select state::text from public.inquiries where id = $1", [id])
  ).state;
}

async function auditCount(db: Db, action: string, id: string): Promise<number> {
  return count(
    db,
    "select count(*)::int as n from public.audit_log where action = $1 and entity_id = $2",
    [action, id],
  );
}

describe("inquiries (step 11)", () => {
  it("assign_inquiry moves a new inquiry to in_progress for the editor, close_inquiry closes it, and a closed one refuses all three", async () => {
    await withRollback(async (db) => {
      await assertStep11(db);
      const editor = await createStaffUser(db, ["managing_editor"]);
      const assignee = await createStaffUser(db, ["chief_editor"]);
      const id = await createInquiry(db, "2026-10-01T12:00:00Z");
      const assigned = await one<{ state: string }>(db, ASSIGN, [id, assignee, editor]);
      const row = await one<{ assigned_to: string }>(
        db,
        "select assigned_to from public.inquiries where id = $1",
        [id],
      );
      const closed = await one<{ state: string }>(db, CLOSE, [id, editor]);
      expect({
        assigned: assigned.state,
        assignedTo: row.assigned_to,
        closed: closed.state,
        stored: await stateOf(db, id),
        audits: [
          await auditCount(db, "inquiries.assign", id),
          await auditCount(db, "inquiries.close", id),
        ],
        refusals: [
          await attempt(db, ASSIGN, [id, assignee, editor]),
          await attempt(db, FORWARD, [id, editor]),
          await attempt(db, CLOSE, [id, editor]),
        ],
      }).toEqual({
        assigned: "in_progress",
        assignedTo: assignee,
        closed: "closed",
        stored: "closed",
        audits: [1, 1],
        refusals: ["P0001 wrong_state", "P0001 wrong_state", "P0001 wrong_state"],
      });
    });
  });

  it("assign_inquiry refuses an assignee who may not act on inquiries with validation", async () => {
    await withRollback(async (db) => {
      await assertStep11(db);
      const editor = await createStaffUser(db, ["managing_editor"]);
      const commercial = await createStaffUser(db, ["commercial"]);
      const id = await createInquiry(db, "2026-10-01T12:00:00Z");
      expect({
        refused: await attempt(db, ASSIGN, [id, commercial, editor]),
        state: await stateOf(db, id),
      }).toEqual({ refused: "22023 validation", state: "new" });
    });
  });

  it("two forward_inquiry calls create jobs keyed :1 and :2, write two inquiries.forward rows and leave the state", async () => {
    await withRollback(async (db) => {
      await assertStep11(db);
      const editor = await createStaffUser(db, ["chief_editor"]);
      const id = await createInquiry(db, "2026-10-01T12:00:00Z");
      const first = await one<{ job: string }>(db, FORWARD, [id, editor]);
      const second = await one<{ job: string }>(db, FORWARD, [id, editor]);
      const jobs = await db.query<{ idempotency_key: string; payload: unknown }>(
        "select idempotency_key, payload from public.jobs where id = any ($1::uuid[]) order by idempotency_key",
        [[first.job, second.job]],
      );
      expect({
        jobs: jobs.rows,
        audits: await auditCount(db, "inquiries.forward", id),
        state: await stateOf(db, id),
      }).toEqual({
        jobs: [
          { idempotency_key: `webhook_omnikom:${id}:1`, payload: { data: { inquiry_id: id } } },
          { idempotency_key: `webhook_omnikom:${id}:2`, payload: { data: { inquiry_id: id } } },
        ],
        audits: 2,
        state: "new",
      });
    });
  });

  it("forward_inquiry raises enqueue_failed and writes no audit row when enqueue_job_manual queues nothing (DB-09)", async () => {
    await withRollback(async (db) => {
      await assertStep11(db);
      const editor = await createStaffUser(db, ["chief_editor"]);
      const id = await createInquiry(db, "2026-10-01T12:00:00Z");
      await db.query(
        `create or replace function public.enqueue_job_manual(
           p_type text, p_entity_id uuid, p_payload jsonb, p_max_attempts int default 5
         ) returns uuid language sql as $$ select null::uuid $$`,
      );
      expect({
        refused: await attempt(db, FORWARD, [id, editor]),
        audits: await auditCount(db, "inquiries.forward", id),
      }).toEqual({ refused: "P0001 enqueue_failed", audits: 0 });
    });
  });

  it("list_inquiries filters by state and pages newest first after a cursor", async () => {
    await withRollback(async (db) => {
      await assertStep11(db);
      const editor = await createStaffUser(db, ["chief_editor"]);
      const assignee = await createStaffUser(db, ["managing_editor"]);
      const old = await createInquiry(db, "2000-01-01T00:00:00Z");
      const older = await createInquiry(db, "1999-12-31T00:00:00Z");
      const taken = await createInquiry(db, "1999-12-30T00:00:00Z");
      await db.query(ASSIGN, [taken, assignee, editor]);
      const page = await db.query<{ id: string }>(
        `select id from public.list_inquiries(10, 'new', '2000-01-01T00:00:00Z', $1)
         where id = any ($2::uuid[])`,
        [old, [old, older, taken]],
      );
      expect(page.rows.map((found) => found.id)).toEqual([older]);
    });
  });
});

/** The case runs only against a database that holds step 12's migration (P-328). */
async function assertStep12(db: Db): Promise<void> {
  const { present } = await one<{ present: boolean }>(
    db,
    `select to_regproc('public.save_story') is not null and to_regproc('public.publish_story') is not null
       and to_regproc('public.unpublish_story') is not null and to_regproc('public.list_stories') is not null as present`,
  );
  expect(present).toBe(true);
}

const SAVE_STORY =
  "select public.save_story($1::uuid, $2::timestamptz, $3::jsonb, $4, 'human', 'req-stories', $5) as answer";
const PUBLISH_STORY =
  "select public.publish_story($1, $2::timestamptz, $3, 'human', 'req-stories') as answer";
const UNPUBLISH_STORY = "select public.unpublish_story($1, $2, 'human', 'req-stories') as answer";

interface StoryAnswer {
  answer: { id: string; updated_at: string };
}

interface StoryRow {
  id: string;
  updated_at: string;
}

/** A draft story as B2's seed or an earlier save leaves it; `updated_at` as text keeps its microseconds. */
async function createStory(
  db: Db,
  slug: string,
  over: { image?: string | null; updatedAt?: string; state?: string } = {},
): Promise<StoryRow> {
  await markets(db);
  return one<StoryRow>(
    db,
    `insert into public.stories (slug, title, deck, category, market_slug, image, updated_at, editorial_state)
     values ($1, 'Fixture story', 'A deck.', 'Places', 'california', $2, coalesce($3::timestamptz, now()),
       coalesce($4::public.editorial_state, 'draft'))
     returning id, updated_at::text as updated_at`,
    [slug, over.image ?? null, over.updatedAt ?? null, over.state ?? null],
  );
}

const stagedPath = (slug: string) => `staging/story/${slug}/${randomUUID()}.jpg`;

async function storyJobs(db: Db, slug: string) {
  return (
    await db.query<{ heavy: boolean; payload: unknown; key: string }>(
      `select heavy, payload, idempotency_key as key from public.jobs
       where type = 'render_variants' and payload -> 'data' ->> 'slug' = $1`,
      [slug],
    )
  ).rows;
}

async function storyOf(db: Db, id: string) {
  return one<{ image: string | null; state: string; published: boolean; archived: boolean }>(
    db,
    `select image, editorial_state::text as state, published_at is not null as published,
       archived_at is not null as archived from public.stories where id = $1`,
    [id],
  );
}

const fullPatch = (slug: string) => ({
  title: "A quiet house",
  slug,
  deck: "A house kept by one family.",
  category: "Places",
  market_slug: "california",
});

describe("stories (step 12)", () => {
  it("save_story with a staged image queues exactly one heavy render_variants job keyed by the story and the path, and leaves image unchanged", async () => {
    await withRollback(async (db) => {
      await assertStep12(db);
      const editor = await createStaffUser(db, ["visual_editor"]);
      const story = await createStory(db, "queued-story", { image: "old/key.webp" });
      const path = stagedPath("queued-story");
      const first = await one<StoryAnswer>(db, SAVE_STORY, [
        story.id,
        story.updated_at,
        "{}",
        editor,
        path,
      ]);
      await db.query(SAVE_STORY, [story.id, first.answer.updated_at, "{}", editor, path]);
      expect({
        jobs: await storyJobs(db, "queued-story"),
        stored: await storyOf(db, story.id),
      }).toEqual({
        jobs: [
          {
            heavy: true,
            payload: {
              params: {},
              data: { target: "story", slug: "queued-story", staging_path: path },
            },
            key: `render_variants:story:queued-story:${path}`,
          },
        ],
        stored: { image: "old/key.webp", state: "draft", published: false, archived: false },
      });
    });
  });

  it("save_story without a staging path queues none, and a path under another story folder raises invalid_key", async () => {
    await withRollback(async (db) => {
      await assertStep12(db);
      const editor = await createStaffUser(db, ["visual_editor"]);
      const story = await createStory(db, "plain-story");
      await db.query(SAVE_STORY, [story.id, story.updated_at, '{"title": "Edited"}', editor, null]);
      const refused = await attempt(db, SAVE_STORY, [
        story.id,
        story.updated_at,
        "{}",
        editor,
        stagedPath("another-story"),
      ]);
      expect({ jobs: await storyJobs(db, "plain-story"), refused }).toEqual({
        jobs: [],
        refused: "P0001 invalid_key",
      });
    });
  });

  it("save_story refuses a patch that carries image, image_variants or an unknown key with invalid_key", async () => {
    await withRollback(async (db) => {
      await assertStep12(db);
      const editor = await createStaffUser(db, ["visual_editor"]);
      const story = await createStory(db, "guarded-story", { image: "old/key.webp" });
      const refused = async (patch: string) =>
        attempt(db, SAVE_STORY, [story.id, story.updated_at, patch, editor, null]);
      expect({
        refusals: [
          await refused('{"image": "other/key.webp"}'),
          await refused('{"image_variants": {}}'),
          await refused('{"editorial_state": "published"}'),
        ],
        stored: (await storyOf(db, story.id)).image,
      }).toEqual({
        refusals: ["P0001 invalid_key", "P0001 invalid_key", "P0001 invalid_key"],
        stored: "old/key.webp",
      });
    });
  });

  it("save_story with no id inserts one draft with a null image and one stories.write audit row, and refuses a missing slug or deck with invalid_key", async () => {
    await withRollback(async (db) => {
      await assertStep12(db);
      await markets(db);
      const editor = await createStaffUser(db, ["visual_editor"]);
      const slug = "new-story";
      const { slug: _slug, ...withoutSlug } = fullPatch(slug);
      const { deck: _deck, ...withoutDeck } = fullPatch(slug);
      const refusals = [
        await attempt(db, SAVE_STORY, [null, null, JSON.stringify(withoutSlug), editor, null]),
        await attempt(db, SAVE_STORY, [null, null, JSON.stringify(withoutDeck), editor, null]),
      ];
      const inserted = await one<StoryAnswer>(db, SAVE_STORY, [
        null,
        null,
        JSON.stringify(fullPatch(slug)),
        editor,
        null,
      ]);
      const rows = await db.query<{
        id: string;
        image: string | null;
        state: string;
        author: string;
      }>(
        "select id, image, editorial_state::text as state, author_id as author from public.stories where slug = $1",
        [slug],
      );
      expect({
        refusals,
        rows: rows.rows,
        audits: await auditCount(db, "stories.write", inserted.answer.id),
      }).toEqual({
        refusals: ["P0001 invalid_key", "P0001 invalid_key"],
        rows: [{ id: inserted.answer.id, image: null, state: "draft", author: editor }],
        audits: 1,
      });
    });
  });

  it("save_story with a stale updated_at raises stale and changes nothing; a slug changes while the story is a draft and is locked once it is not", async () => {
    await withRollback(async (db) => {
      await assertStep12(db);
      const editor = await createStaffUser(db, ["visual_editor"]);
      const story = await createStory(db, "stale-story");
      const stale = await attempt(db, SAVE_STORY, [
        story.id,
        "2000-01-01T00:00:00Z",
        '{"title": "Late"}',
        editor,
        null,
      ]);
      await db.query(SAVE_STORY, [
        story.id,
        story.updated_at,
        '{"slug": "renamed-story"}',
        editor,
        null,
      ]);
      const live = await createStory(db, "live-story", { image: "old/key.webp" });
      await db.query(
        "update public.stories set editorial_state = 'published', published_at = now() where id = $1",
        [live.id],
      );
      const current = await one<StoryRow>(
        db,
        "select id, updated_at::text as updated_at from public.stories where id = $1",
        [live.id],
      );
      const locked = await attempt(db, SAVE_STORY, [
        live.id,
        current.updated_at,
        '{"slug": "moved-story"}',
        editor,
        null,
      ]);
      const names = await db.query<{ slug: string; title: string }>(
        "select slug, title from public.stories where id = any ($1::uuid[]) order by slug",
        [[story.id, live.id]],
      );
      expect({ stale, locked, names: names.rows }).toEqual({
        stale: "P0001 stale",
        locked: "P0001 slug_immutable",
        names: [
          { slug: "live-story", title: "Fixture story" },
          { slug: "renamed-story", title: "Fixture story" },
        ],
      });
    });
  });

  it("publish_story on a draft without an image raises publish_incomplete naming the image, and changes nothing", async () => {
    await withRollback(async (db) => {
      await assertStep12(db);
      const editor = await createStaffUser(db, ["managing_editor"]);
      const created = await one<StoryAnswer>(db, SAVE_STORY, [
        null,
        null,
        JSON.stringify(fullPatch("no-image-story")),
        await createStaffUser(db, ["visual_editor"]),
        null,
      ]);
      const refused = await attempt(db, PUBLISH_STORY, [
        created.answer.id,
        created.answer.updated_at,
        editor,
      ]);
      expect({ refused, stored: (await storyOf(db, created.answer.id)).state }).toEqual({
        refused: "23514 publish_incomplete",
        stored: "draft",
      });
    });
  });

  it("publish_story publishes a story with an image once with one stories.publish row, refuses a live one with wrong_state and a stale copy with stale, and publishes an archived one again", async () => {
    await withRollback(async (db) => {
      await assertStep12(db);
      const editor = await createStaffUser(db, ["chief_editor"]);
      const story = await createStory(db, "ready-story", { image: "s/ready-0a1b2c3d.webp" });
      const stale = await attempt(db, PUBLISH_STORY, [story.id, "2000-01-01T00:00:00Z", editor]);
      const published = await one<StoryAnswer>(db, PUBLISH_STORY, [
        story.id,
        story.updated_at,
        editor,
      ]);
      const live = await storyOf(db, story.id);
      const again = await attempt(db, PUBLISH_STORY, [
        story.id,
        published.answer.updated_at,
        editor,
      ]);
      const audits = await auditCount(db, "stories.publish", story.id);
      const unpublished = await one<StoryAnswer>(db, UNPUBLISH_STORY, [story.id, editor]);
      await db.query(PUBLISH_STORY, [story.id, unpublished.answer.updated_at, editor]);
      expect({ stale, live, again, audits, republished: await storyOf(db, story.id) }).toEqual({
        stale: "P0001 stale",
        live: {
          image: "s/ready-0a1b2c3d.webp",
          state: "published",
          published: true,
          archived: false,
        },
        again: "P0001 wrong_state",
        audits: 1,
        republished: {
          image: "s/ready-0a1b2c3d.webp",
          state: "published",
          published: true,
          archived: false,
        },
      });
    });
  });

  it("unpublish_story archives a live story with archived_at and one stories.unpublish row, and refuses a draft with wrong_state", async () => {
    await withRollback(async (db) => {
      await assertStep12(db);
      const editor = await createStaffUser(db, ["managing_editor"]);
      const story = await createStory(db, "live-one", { image: "s/live-0a1b2c3d.webp" });
      await db.query(PUBLISH_STORY, [story.id, story.updated_at, editor]);
      const draft = await createStory(db, "draft-one");
      await db.query(UNPUBLISH_STORY, [story.id, editor]);
      expect({
        archived: await storyOf(db, story.id),
        audits: await auditCount(db, "stories.unpublish", story.id),
        draft: await attempt(db, UNPUBLISH_STORY, [draft.id, editor]),
      }).toEqual({
        archived: {
          image: "s/live-0a1b2c3d.webp",
          state: "archived",
          published: false,
          archived: true,
        },
        audits: 1,
        draft: "P0001 wrong_state",
      });
    });
  });

  it("list_stories filters by state and pages last edited first after a cursor", async () => {
    await withRollback(async (db) => {
      await assertStep12(db);
      const newest = await createStory(db, "list-newest", { updatedAt: "2000-01-03T00:00:00Z" });
      const middle = await createStory(db, "list-middle", { updatedAt: "2000-01-02T00:00:00Z" });
      const oldest = await createStory(db, "list-oldest", {
        updatedAt: "2000-01-01T00:00:00Z",
        state: "review",
      });
      const ids = [newest.id, middle.id, oldest.id];
      const page = async (state: string) =>
        (
          await db.query<{ id: string }>(
            `select id from public.list_stories(10, $1::public.editorial_state, '2000-01-03T00:00:00Z', $2)
             where id = any ($3::uuid[])`,
            [state, newest.id, ids],
          )
        ).rows.map((found) => found.id);
      expect({ drafts: await page("draft"), reviews: await page("review") }).toEqual({
        drafts: [middle.id],
        reviews: [oldest.id],
      });
    });
  });
});

/** The case runs only against a database that holds step 13's migration (P-328). */
async function assertStep13(db: Db): Promise<void> {
  const { present } = await one<{ present: boolean }>(
    db,
    `select to_regproc('public.update_market') is not null
       and to_regproc('public.set_market_coming_soon') is not null as present`,
  );
  expect(present).toBe(true);
}

const TOGGLE =
  "select public.set_market_coming_soon(p_slug => $1, p_coming_soon => $2, p_actor => $3, p_actor_kind => 'human', p_request_id => 't', p_notify => $4) as answer";
const UPDATE_MARKET =
  "select public.update_market($1, $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb, $6, 'human', 'req-markets', $7) as answer";

/** The market as the case needs it: its fixture row, with `coming_soon` set and no job left from an earlier run. */
async function marketIn(db: Db, comingSoon: boolean): Promise<void> {
  await markets(db);
  await db.query("update public.markets set coming_soon = $1 where slug = 'california'", [
    comingSoon,
  ]);
  await db.query("delete from public.jobs where idempotency_key = 'market_open:california'");
}

async function openNotices(db: Db) {
  return (
    await db.query<{ key: string; payload: unknown }>(
      `select idempotency_key as key, payload from public.jobs
       where type = 'market_open_notice' and payload -> 'data' ->> 'market' = 'california'`,
    )
  ).rows;
}

async function marketAudits(db: Db, action: string): Promise<number> {
  return count(
    db,
    "select count(*)::int as n from public.audit_log where action = $1 and entity = 'markets.california'",
    [action],
  );
}

async function comingSoonOf(db: Db): Promise<boolean> {
  return (
    await one<{ coming_soon: boolean }>(
      db,
      "select coming_soon from public.markets where slug = 'california'",
    )
  ).coming_soon;
}

async function renderJobsOf(db: Db) {
  return (
    await db.query<{ heavy: boolean; payload: unknown; key: string }>(
      `select heavy, payload, idempotency_key as key from public.jobs
       where type = 'render_variants' and payload -> 'data' ->> 'target' in ('market', 'region')
         and payload -> 'data' ->> 'slug' in ('california', 'bay-area')
       order by payload -> 'data' ->> 'target'`,
    )
  ).rows;
}

const note = (label: string) => ({ label, text: `${label} text` });

describe("markets (step 13)", () => {
  it("set_market_coming_soon with p_notify on a coming-soon market opens it and queues exactly one market_open_notice job keyed market_open:california, and closing it then opening it again queues none", async () => {
    await withRollback(async (db) => {
      await assertStep13(db);
      const editor = await createStaffUser(db, ["managing_editor"]);
      await marketIn(db, true);
      await db.query(TOGGLE, ["california", false, editor, true]);
      const opened = { open: !(await comingSoonOf(db)), jobs: await openNotices(db) };
      await db.query(TOGGLE, ["california", true, editor, true]);
      const closed = { open: !(await comingSoonOf(db)), jobs: (await openNotices(db)).length };
      await db.query(TOGGLE, ["california", false, editor, true]);
      expect({ opened, closed, again: (await openNotices(db)).length }).toEqual({
        opened: {
          open: true,
          jobs: [
            {
              key: "market_open:california",
              payload: { params: {}, data: { market: "california" } },
            },
          ],
        },
        closed: { open: false, jobs: 1 },
        again: 1,
      });
    });
  });

  it("set_market_coming_soon without p_notify opens the market and queues no market_open_notice job", async () => {
    await withRollback(async (db) => {
      await assertStep13(db);
      const editor = await createStaffUser(db, ["chief_editor"]);
      await marketIn(db, true);
      await db.query(TOGGLE, ["california", false, editor, false]);
      expect({ open: !(await comingSoonOf(db)), jobs: await openNotices(db) }).toEqual({
        open: true,
        jobs: [],
      });
    });
  });

  it("set_market_coming_soon writes one markets.coming_soon audit row per change, none for a repeat, and refuses a commercial user and an unknown market", async () => {
    await withRollback(async (db) => {
      await assertStep13(db);
      const editor = await createStaffUser(db, ["managing_editor"]);
      const commercial = await createStaffUser(db, ["commercial"]);
      await marketIn(db, true);
      await db.query(TOGGLE, ["california", false, editor, false]);
      await db.query(TOGGLE, ["california", false, editor, false]);
      await db.query(TOGGLE, ["california", true, editor, false]);
      expect({
        audits: await marketAudits(db, "markets.coming_soon"),
        commercial: await attempt(db, TOGGLE, ["california", false, commercial, false]),
        unknown: await attempt(db, TOGGLE, ["texas", false, editor, false]),
        stillClosed: await comingSoonOf(db),
      }).toEqual({
        audits: 2,
        commercial: "42501 forbidden",
        unknown: "P0002 not_found",
        stillClosed: true,
      });
    });
  });

  it("update_market with two notes leaves exactly those two rows with sort_order 0 and 1, with three guide entries exactly those three, and with null notes leaves the notes alone", async () => {
    await withRollback(async (db) => {
      await assertStep13(db);
      const editor = await createStaffUser(db, ["managing_editor"]);
      await markets(db);
      const rows = (table: string) =>
        db.query<{ label: string; sort_order: number }>(
          `select label, sort_order from public.${table} where market_slug = 'california' order by sort_order`,
        );
      await db.query(UPDATE_MARKET, [
        "california",
        "{}",
        null,
        JSON.stringify([note("Light"), note("Water")]),
        JSON.stringify([
          { section: "need", label: "Parking", text: "t" },
          { section: "service", region_slug: "bay-area", label: "Movers", text: "t" },
          { section: "neighborhood", label: "Pacific Heights", text: "t" },
        ]),
        editor,
        null,
      ]);
      const first = {
        notes: (await rows("market_notes")).rows,
        guide: (await rows("market_guide_entries")).rows,
      };
      await db.query(UPDATE_MARKET, ["california", "{}", null, null, null, editor, null]);
      expect({ first, kept: (await rows("market_notes")).rows }).toEqual({
        first: {
          notes: [
            { label: "Light", sort_order: 0 },
            { label: "Water", sort_order: 1 },
          ],
          guide: [
            { label: "Parking", sort_order: 0 },
            { label: "Movers", sort_order: 1 },
            { label: "Pacific Heights", sort_order: 2 },
          ],
        },
        kept: [
          { label: "Light", sort_order: 0 },
          { label: "Water", sort_order: 1 },
        ],
      });
    });
  });

  it("update_market changes the market fields, upserts a region by slug and writes one markets.edit audit row", async () => {
    await withRollback(async (db) => {
      await assertStep13(db);
      const editor = await createStaffUser(db, ["managing_editor"]);
      await markets(db);
      const region = (slug: string, name: string) => ({
        slug,
        name,
        intro: `${name} intro`,
        places: ["One", "Two"],
        sort_order: 3,
      });
      const answer = await one<{ answer: { slug: string } }>(db, UPDATE_MARKET, [
        "california",
        JSON.stringify({
          name: "California Coast",
          places: ["Malibu", "Carmel"],
          interest_copy: null,
        }),
        JSON.stringify([region("bay-area", "San Francisco Bay"), region("big-sur", "Big Sur")]),
        null,
        null,
        editor,
        null,
      ]);
      expect({
        answer: answer.answer.slug,
        market: await one(
          db,
          "select name, places, interest_copy from public.markets where slug = 'california'",
        ),
        regions: (
          await db.query(
            `select slug, market_slug, name, places, sort_order from public.regions
             where slug in ('bay-area', 'big-sur') order by slug`,
          )
        ).rows,
        audits: await marketAudits(db, "markets.edit"),
      }).toEqual({
        answer: "california",
        market: { name: "California Coast", places: ["Malibu", "Carmel"], interest_copy: null },
        regions: [
          {
            slug: "bay-area",
            market_slug: "california",
            name: "San Francisco Bay",
            places: ["One", "Two"],
            sort_order: 3,
          },
          {
            slug: "big-sur",
            market_slug: "california",
            name: "Big Sur",
            places: ["One", "Two"],
            sort_order: 3,
          },
        ],
        audits: 1,
      });
    });
  });

  it("update_market with a market image path and one region image path queues exactly two heavy render_variants jobs keyed by target, slug and path, and leaves both image values unchanged", async () => {
    await withRollback(async (db) => {
      await assertStep13(db);
      const editor = await createStaffUser(db, ["managing_editor"]);
      await markets(db);
      await db.query("update public.markets set image = 'm/old.webp' where slug = 'california'");
      await db.query("update public.regions set image = 'r/old.webp' where slug = 'bay-area'");
      await db.query(
        "delete from public.jobs where type = 'render_variants' and payload -> 'data' ->> 'slug' in ('california', 'bay-area')",
      );
      const marketPath = `staging/market/california/${randomUUID()}.jpg`;
      const regionPath = `staging/region/bay-area/${randomUUID()}.jpg`;
      const regions = JSON.stringify([
        {
          slug: "bay-area",
          name: "Bay Area",
          intro: "x",
          places: [],
          sort_order: 0,
          image_staging_path: regionPath,
        },
      ]);
      await db.query(UPDATE_MARKET, ["california", "{}", regions, null, null, editor, marketPath]);
      await db.query(UPDATE_MARKET, ["california", "{}", regions, null, null, editor, marketPath]);
      const imageOf = async (table: string, slug: string) =>
        (
          await one<{ image: string }>(db, `select image from public.${table} where slug = $1`, [
            slug,
          ])
        ).image;
      expect({
        jobs: await renderJobsOf(db),
        images: [await imageOf("markets", "california"), await imageOf("regions", "bay-area")],
      }).toEqual({
        jobs: [
          {
            heavy: true,
            payload: {
              params: {},
              data: { target: "market", slug: "california", staging_path: marketPath },
            },
            key: `render_variants:market:california:${marketPath}`,
          },
          {
            heavy: true,
            payload: {
              params: {},
              data: { target: "region", slug: "bay-area", staging_path: regionPath },
            },
            key: `render_variants:region:bay-area:${regionPath}`,
          },
        ],
        images: ["m/old.webp", "r/old.webp"],
      });
    });
  });

  it("update_market refuses image, coming_soon and unknown keys, a path under another folder, a region of another market and a guide entry for one, with invalid_key and no change", async () => {
    await withRollback(async (db) => {
      await assertStep13(db);
      const editor = await createStaffUser(db, ["managing_editor"]);
      await markets(db);
      await db.query(
        `insert into public.regions (slug, market_slug, name, intro) values ('miami', 'florida', 'Miami', 'x')
         on conflict (slug) do nothing`,
      );
      const refused = (patch: unknown, regions: unknown, guide: unknown, path: string | null) =>
        attempt(db, UPDATE_MARKET, [
          "california",
          JSON.stringify(patch),
          regions === null ? null : JSON.stringify(regions),
          null,
          guide === null ? null : JSON.stringify(guide),
          editor,
          path,
        ]);
      const miami = { slug: "miami", name: "Miami", intro: "x", places: [], sort_order: 0 };
      const foreignImage = `staging/region/miami/${randomUUID()}.jpg`;
      expect({
        image: await refused({ image: "m/x.webp" }, null, null, null),
        comingSoon: await refused({ coming_soon: false }, null, null, null),
        unknown: await refused({ slug: "texas" }, null, null, null),
        foreignPath: await refused({}, null, null, `staging/market/florida/${randomUUID()}.jpg`),
        foreignRegion: await refused({}, [miami], null, null),
        regionPath: await refused(
          {},
          [{ ...miami, slug: "bay-area", image_staging_path: foreignImage }],
          null,
          null,
        ),
        guideRegion: await refused(
          {},
          null,
          [{ section: "need", region_slug: "miami", label: "a", text: "b" }],
          null,
        ),
        section: await refused({}, null, [{ section: "other", label: "a", text: "b" }], null),
        jobs: (await renderJobsOf(db)).length,
      }).toEqual({
        image: "P0001 invalid_key",
        comingSoon: "P0001 invalid_key",
        unknown: "P0001 invalid_key",
        foreignPath: "P0001 invalid_key",
        foreignRegion: "P0001 invalid_key",
        regionPath: "P0001 invalid_key",
        guideRegion: "P0001 invalid_key",
        section: "P0001 invalid_key",
        jobs: 0,
      });
    });
  });

  it("update_market is refused for a commercial user with forbidden and for an unknown market with not_found", async () => {
    await withRollback(async (db) => {
      await assertStep13(db);
      const editor = await createStaffUser(db, ["managing_editor"]);
      const commercial = await createStaffUser(db, ["commercial"]);
      await markets(db);
      const call = (slug: string, actor: string) =>
        attempt(db, UPDATE_MARKET, [slug, "{}", null, null, null, actor, null]);
      expect({
        commercial: await call("california", commercial),
        unknown: await call("texas", editor),
      }).toEqual({ commercial: "42501 forbidden", unknown: "P0002 not_found" });
    });
  });
});

async function assertStep14(db: Db): Promise<void> {
  const { present } = await one<{ present: boolean }>(
    db,
    `select to_regproc('public.team_users') is not null
       and to_regproc('public.revoke_all_agent_keys') is not null as present`,
  );
  expect(present).toBe(true);
}

/** Leaves `admin` with the only enabled admin row of the transaction: every other admin row is disabled in it. */
async function onlyAdmin(db: Db, roles: string[]): Promise<string> {
  await db.query(
    "update public.user_roles set disabled_at = now() where role = 'admin' and disabled_at is null",
  );
  return createStaffUser(db, roles);
}

const REVOKE_ROLE = "select public.revoke_role($1, $2::public.app_role, $3, 'human', 'r-team')";
const DISABLE = "select public.set_user_disabled($1, $2, $3, 'human', 'r-team')";
const GRANT =
  "select public.grant_role($1, $2::public.app_role, $3, $4, 'human', 'r-team', $5::public.actor_kind, $6)";

/** The `team_users` row of one user: the page that starts right after the user id before it. */
async function teamRow(db: Db, userId: string): Promise<Record<string, unknown> | undefined> {
  const { rows } = await db.query<Record<string, unknown>>(
    `select t.user_id, t.email, t.display_name, t.roles::text[] as roles, t.actor_kind, t.disabled
     from public.team_users(1, (
       select r.user_id from public.user_roles r where r.user_id < $1 order by r.user_id desc limit 1
     )) t`,
    [userId],
  );
  return rows.find((row) => row["user_id"] === userId);
}

async function teamAudit(db: Db, action: string): Promise<unknown[]> {
  const { rows } = await db.query<{ after: unknown; note: string | null }>(
    "select after, note from public.audit_log where request_id = 'r-team' and action = $1 order by id",
    [action],
  );
  return rows;
}

describe("team (step 14)", () => {
  it("with one enabled admin, revoke_role of its admin row and set_user_disabled of the user each raise last_admin; with a second admin both pass", async () => {
    await withRollback(async (db) => {
      await assertStep14(db);
      const first = await onlyAdmin(db, ["admin", "chief_editor"]);
      const alone = {
        revoke: await attempt(db, REVOKE_ROLE, [first, "admin", first]),
        disable: await attempt(db, DISABLE, [first, true, first]),
      };
      const second = await createStaffUser(db, ["admin"]);
      const third = await createStaffUser(db, ["admin"]);
      // Each paired call takes an enabled admin row while another enabled admin exists, so both reach the guard.
      const paired = {
        revoke: await attempt(db, REVOKE_ROLE, [first, "admin", second]),
        disable: await attempt(db, DISABLE, [second, true, third]),
      };
      expect({
        alone,
        paired,
        audit: {
          revoke: (await teamAudit(db, "team.role_revoke")).length,
          disable: await teamAudit(db, "team.user_disable"),
        },
      }).toEqual({
        alone: { revoke: "P0001 last_admin", disable: "P0001 last_admin" },
        paired: { revoke: "ok", disable: "ok" },
        audit: {
          revoke: 1,
          disable: [{ after: { id: second, disabled: true }, note: null }],
        },
      });
    });
  });

  it("an agent holding admin does not count as a second admin", async () => {
    await withRollback(async (db) => {
      await assertStep14(db);
      const person = await onlyAdmin(db, ["admin"]);
      const bot = await createAuthUser(db);
      await db.query(
        "insert into public.user_roles (user_id, role, actor_kind) values ($1, 'admin', 'agent')",
        [bot],
      );
      expect(await attempt(db, DISABLE, [person, true, person])).toBe("P0001 last_admin");
    });
  });

  it("revoke_all_agent_keys returns the number of unrevoked keys, leaves none unrevoked and writes one team.revoke_all_keys row with the count", async () => {
    await withRollback(async (db) => {
      await assertStep14(db);
      const admin = await createStaffUser(db, ["admin"]);
      const bot = await createAuthUser(db);
      await db.query(
        `insert into public.agent_keys (user_id, key_hash, label, revoked_at)
         values ($1, md5(random()::text), 'a', null), ($1, md5(random()::text), 'b', null),
                ($1, md5(random()::text), 'old', now() - interval '1 day')`,
        [bot],
      );
      const { live } = await one<{ live: number }>(
        db,
        "select count(*)::int as live from public.agent_keys where revoked_at is null",
      );
      const { revoked } = await one<{ revoked: number }>(
        db,
        "select public.revoke_all_agent_keys($1, 'human', 'r-team') as revoked",
        [admin],
      );
      const { left } = await one<{ left: number }>(
        db,
        "select count(*)::int as left from public.agent_keys where revoked_at is null",
      );
      expect({ revoked, left, audit: await teamAudit(db, "team.revoke_all_keys") }).toEqual({
        revoked: live,
        left: 0,
        audit: [{ after: { count: live }, note: null }],
      });
      expect(live).toBeGreaterThanOrEqual(2);
    });
  });

  it("team_users returns a staff user made with createStaffUser with its auth email, its role, kind human and not disabled", async () => {
    await withRollback(async (db) => {
      await assertStep14(db);
      const editor = await createStaffUser(db, ["managing_editor"]);
      const { email } = await one<{ email: string }>(
        db,
        "select email from auth.users where id = $1",
        [editor],
      );
      expect(await teamRow(db, editor)).toEqual({
        user_id: editor,
        email,
        display_name: null,
        roles: ["managing_editor"],
        actor_kind: "human",
        disabled: false,
      });
    });
  });

  it("grant_role with p_user_kind agent and p_display_name Queue bot leaves an agent row with that name, team_users returns it and a staff user, and a human grant to it raises invalid_key", async () => {
    await withRollback(async (db) => {
      await assertStep14(db);
      const admin = await createStaffUser(db, ["admin"]);
      const editor = await createStaffUser(db, ["managing_editor"]);
      const bot = await createAuthUser(db);
      await db.query(GRANT, [bot, "managing_editor", "agent_create", admin, "agent", "Queue bot"]);
      const { rows } = await db.query<{ actor_kind: string; display_name: string }>(
        "select actor_kind, display_name from public.user_roles where user_id = $1",
        [bot],
      );
      const kinds = [await teamRow(db, bot), await teamRow(db, editor)].map((row) => [
        row?.["user_id"],
        row?.["actor_kind"],
        row?.["display_name"],
      ]);
      expect({
        rows,
        kinds,
        human: await attempt(db, GRANT, [bot, "media_ops", null, admin, "human", null]),
        audit: (
          await db.query(
            `select after ->> 'role' as role, after ->> 'actor_kind' as kind, note
             from public.audit_log where request_id = 'r-team' and action = 'team.role_grant'`,
          )
        ).rows,
      }).toEqual({
        rows: [{ actor_kind: "agent", display_name: "Queue bot" }],
        kinds: [
          [bot, "agent", "Queue bot"],
          [editor, "human", null],
        ],
        human: "P0001 invalid_key",
        audit: [{ role: "managing_editor", kind: "agent", note: "agent_create" }],
      });
    });
  });

  it("create_agent_key stores the hash for an agent only, refuses the team scope, and revoke_agent_key revokes once", async () => {
    await withRollback(async (db) => {
      await assertStep14(db);
      const admin = await createStaffUser(db, ["admin"]);
      const bot = await createAuthUser(db);
      await db.query(GRANT, [bot, "managing_editor", "agent_create", admin, "agent", "Queue bot"]);
      const create = (user: string, scopes: string[]) =>
        `select public.create_agent_key('${user}', 'hash-${randomUUID()}', 'k', '{${scopes.join(",")}}', '${admin}', 'human', 'r-team') as id`;
      const refused = {
        human: await attempt(db, create(admin, ["submissions"])),
        team: await attempt(db, create(bot, ["submissions", "team"])),
      };
      const { id } = await one<{ id: string }>(db, create(bot, ["submissions"]));
      const revoke = "select public.revoke_agent_key($1, $2, 'human', 'r-team')";
      const first = await attempt(db, revoke, [id, admin]);
      const again = await attempt(db, revoke, [id, admin]);
      const { rows } = await db.query<{ revoked: boolean }>(
        "select revoked_at is not null as revoked from public.agent_keys where id = $1",
        [id],
      );
      const created = await teamAudit(db, "team.agent_key_create");
      expect({ refused, first, again, rows, created }).toEqual({
        refused: { human: "P0001 invalid_kind", team: "22023 validation" },
        first: "ok",
        again: "P0001 wrong_state",
        rows: [{ revoked: true }],
        created: [
          {
            after: { id, user_id: bot, label: "k", scopes: ["submissions"] },
            note: null,
          },
        ],
      });
    });
  });

  it("put_setting writes agent_daily_limits with one team.limits_put row and refuses invoice with invalid_key", async () => {
    await withRollback(async (db) => {
      await assertStep14(db);
      const admin = await createStaffUser(db, ["admin"]);
      const value = { decisions_per_day: 9, publish_per_day: 3, requests_per_day: 500 };
      const put = "select public.put_setting($1, $2::jsonb, $3, 'human', 'r-team')";
      const written = await attempt(db, put, ["agent_daily_limits", JSON.stringify(value), admin]);
      const invoice = await attempt(db, put, ["invoice", "{}", admin]);
      const { stored } = await one<{ stored: unknown }>(
        db,
        "select value as stored from public.settings where key = 'agent_daily_limits'",
      );
      expect({
        written,
        invoice,
        stored,
        audit: (await teamAudit(db, "team.limits_put")).length,
      }).toEqual({
        written: "ok",
        invoice: "P0001 invalid_key",
        stored: value,
        audit: 1,
      });
    });
  });
});

/** The case runs only against a database that holds step 15's migration (P-328). */
async function assertStep15(db: Db): Promise<void> {
  const { present } = await one<{ present: boolean }>(
    db,
    `select to_regclass('public.audit_log_list_idx') is not null
       and position('notifications' in (select prosrc from pg_proc where proname = 'put_setting')) > 0 as present`,
  );
  expect(present).toBe(true);
}

const PUT_SETTING = "select public.put_setting($1, $2::jsonb, $3, 'human', 'r-settings')";

async function settingsAudit(db: Db): Promise<unknown[]> {
  const { rows } = await db.query<{
    action: string;
    entity: string;
    before: unknown;
    after: unknown;
  }>(
    "select action, entity, before, after from public.audit_log where request_id = 'r-settings' order by id",
  );
  return rows;
}

describe("settings (step 15)", () => {
  it("each put_setting writes one audit row with before and after under the action of its key", async () => {
    await withRollback(async (db) => {
      await assertStep15(db);
      const admin = await createStaffUser(db, ["admin"]);
      const before = await one<{ coming: unknown; notifications: unknown; limits: unknown }>(
        db,
        `select (select value from public.settings where key = 'coming_soon_global') as coming,
                (select value from public.settings where key = 'notifications') as notifications,
                (select value from public.settings where key = 'agent_daily_limits') as limits`,
      );
      const coming = before.coming !== true;
      const recipients = { recipients: ["ops@example.invalid"] };
      const limits = { decisions_per_day: 7, publish_per_day: 2, requests_per_day: 300 };
      const results = [
        await attempt(db, PUT_SETTING, ["coming_soon_global", JSON.stringify(coming), admin]),
        await attempt(db, PUT_SETTING, ["notifications", JSON.stringify(recipients), admin]),
        await attempt(db, PUT_SETTING, ["agent_daily_limits", JSON.stringify(limits), admin]),
      ];
      expect({ results, audit: await settingsAudit(db) }).toEqual({
        results: ["ok", "ok", "ok"],
        audit: [
          {
            action: "settings.coming_soon_put",
            entity: "settings.coming_soon_global",
            before: before.coming,
            after: coming,
          },
          {
            action: "settings.notifications_put",
            entity: "settings.notifications",
            before: before.notifications,
            after: recipients,
          },
          {
            action: "team.limits_put",
            entity: "settings.agent_daily_limits",
            before: before.limits,
            after: limits,
          },
        ],
      });
    });
  });

  it("put_setting refuses invoice, site, flags and an unknown key with invalid_key and writes no row", async () => {
    await withRollback(async (db) => {
      await assertStep15(db);
      const admin = await createStaffUser(db, ["admin"]);
      const { stored } = await one<{ stored: unknown }>(
        db,
        "select coalesce(jsonb_object_agg(key, value), '{}') as stored from public.settings where key in ('invoice', 'site', 'flags')",
      );
      const refused = [];
      for (const key of ["invoice", "site", "flags", "catalog_version", "no_such_key"]) {
        refused.push(await attempt(db, PUT_SETTING, [key, "{}", admin]));
      }
      const after = await one<{ stored: unknown; unknown: number }>(
        db,
        `select coalesce(jsonb_object_agg(key, value) filter (where key in ('invoice', 'site', 'flags')), '{}') as stored,
                count(*) filter (where key = 'no_such_key')::int as unknown
         from public.settings`,
      );
      expect({
        refused,
        stored: after.stored,
        unknown: after.unknown,
        audit: await settingsAudit(db),
      }).toEqual({
        refused: refused.map(() => "P0001 invalid_key"),
        stored,
        unknown: 0,
        audit: [],
      });
    });
  });

  it("put_setting refuses a coming_soon_global that is not a boolean and a notifications that is not an object", async () => {
    await withRollback(async (db) => {
      await assertStep15(db);
      const admin = await createStaffUser(db, ["admin"]);
      expect({
        coming: await attempt(db, PUT_SETTING, ["coming_soon_global", '{"on": true}', admin]),
        notifications: await attempt(db, PUT_SETTING, [
          "notifications",
          '["a@example.invalid"]',
          admin,
        ]),
        audit: await settingsAudit(db),
      }).toEqual({ coming: "22023 validation", notifications: "22023 validation", audit: [] });
    });
  });
});

/** The case runs only against a database that holds step 15a's two migrations (P-328). */
async function assertStep15a(db: Db): Promise<void> {
  const { present } = await one<{ present: boolean }>(
    db,
    `select to_regproc('public.put_redirect') is not null and to_regproc('public.archive_redirect') is not null
       and to_regproc('public.export_subject') is not null and to_regproc('public.delete_subject') is not null
       and to_regproc('public.opt_out_subject') is not null
       and to_regproc('public.set_subject_request_status') is not null as present`,
  );
  expect(present).toBe(true);
}

const PUT_REDIRECT =
  "select public.put_redirect($1, $2, $3, $4, 'human', 'r-redirects', $5) ->> 'id' as id";

describe("redirects (step 15a)", () => {
  it("put_redirect refuses an /admin or /api source, an outside target, a query string, a 307, a duplicate active source and a loop with invalid_redirect, and writes no row", async () => {
    await withRollback(async (db) => {
      await assertStep15a(db);
      const admin = await createStaffUser(db, ["admin"]);
      const tag = randomUUID().slice(0, 8);
      const a = `/r-${tag}-a`;
      const b = `/r-${tag}-b`;
      const c = `/r-${tag}-c`;
      const put = (from: string, to: string, status = 301) =>
        attempt(db, PUT_REDIRECT, [from, to, status, admin, null]);
      const setup = [await put(a, b), await put(b, c)];
      const refused = {
        admin: await put("/admin/team", b),
        api: await put("/api/public/site", b),
        outside: await put(`/r-${tag}-x`, "https://example.com/x"),
        query: await put(`${a}?x=1`, c),
        status: await put(`/r-${tag}-y`, b, 307),
        duplicate: await put(a, c),
        loop: await put(c, a),
      };
      const { rows } = await one<{ rows: number }>(
        db,
        "select count(*)::int as rows from public.redirects where from_path like $1",
        [`/r-${tag}-%`],
      );
      const audit = await one<{ n: number }>(
        db,
        "select count(*)::int as n from public.audit_log where request_id = 'r-redirects' and action = 'settings.redirects_put'",
      );
      expect({ setup, refused, rows, audit: audit.n }).toEqual({
        setup: ["ok", "ok"],
        refused: {
          admin: "P0001 invalid_redirect",
          api: "P0001 invalid_redirect",
          outside: "P0001 invalid_redirect",
          query: "P0001 invalid_redirect",
          status: "P0001 invalid_redirect",
          duplicate: "P0001 invalid_redirect",
          loop: "P0001 invalid_redirect",
        },
        rows: 2,
        audit: 2,
      });
    });
  });

  it("archive_redirect sets archived_at and enabled false, keeps the row, refuses a second archive, and the source can be added again", async () => {
    await withRollback(async (db) => {
      await assertStep15a(db);
      const admin = await createStaffUser(db, ["admin"]);
      const from = `/r-${randomUUID().slice(0, 8)}`;
      const { id } = await one<{ id: string }>(db, PUT_REDIRECT, [
        from,
        "/markets",
        302,
        admin,
        null,
      ]);
      await db.query("select public.archive_redirect($1, $2, 'human', 'r-redirects')", [id, admin]);
      const row = await one<{ archived: boolean; enabled: boolean }>(
        db,
        "select archived_at is not null as archived, enabled from public.redirects where id = $1",
        [id],
      );
      const again = await attempt(
        db,
        "select public.archive_redirect($1, $2, 'human', 'r-redirects')",
        [id, admin],
      );
      const readded = await attempt(db, PUT_REDIRECT, [from, "/stories", 301, admin, null]);
      expect({ row, again, readded }).toEqual({
        row: { archived: true, enabled: false },
        again: "P0001 wrong_state",
        readded: "ok",
      });
    });
  });
});

const EXPORT = "select public.export_subject($1, $2, 'human', 'r-subject') as bundle";
const DELETE = "select public.delete_subject($1, $2, 'human', 'r-subject')";
const OPT_OUT = "select public.opt_out_subject($1, $2, 'human', 'r-subject')";
const STATUS = "select public.set_subject_request_status($1, $2, $3, 'human', 'r-subject', $4)";

async function subjectRequest(db: Db, email: string, kind: string): Promise<string> {
  return (
    await one<{ id: string }>(
      db,
      "insert into public.subject_requests (email, kind) values ($1, $2) returning id",
      [email, kind],
    )
  ).id;
}

/** Start verification, then confirm identity: what every fulfilling action waits for. */
async function confirmIdentity(db: Db, request: string, admin: string): Promise<void> {
  await db.query(STATUS, [request, "start_verification", admin, null]);
  await db.query(STATUS, [request, "confirm_identity", admin, "Replied from the address."]);
}

/** One subscriber, one inquiry and two submissions under one contact for `email` (S55). */
async function personRows(db: Db, email: string) {
  await db.query("insert into public.subscribers (email, source) values ($1, 'home')", [email]);
  const { id: inquiry } = await one<{ id: string }>(
    db,
    `insert into public.inquiries (intent, name, email, phone, location, message, details, source_path,
       forwarded_payload)
     values ('ask', 'Test Person', $1, '555', 'Berkeley', 'hello', '{"a": 1}', '/contact',
       jsonb_build_object('email', $1::text))
     returning id`,
    [email],
  );
  const base = await dbNow(db);
  const submissions = [
    await createSubmission(db, { state: "Submitted", n: 9_710, base, submitter_email: email }),
    await createSubmission(db, { state: "Under Review", n: 9_711, base, submitter_email: email }),
  ];
  return { inquiry, submissions };
}

async function subjectAudit(db: Db, request: string): Promise<{ action: string }[]> {
  return (
    await db.query<{ action: string }>(
      "select action from public.audit_log where entity_id = $1 order by id",
      [request],
    )
  ).rows;
}

const auditTrail = (fulfilling: string) => [
  { action: "audit.subject_status" },
  { action: "audit.subject_status" },
  { action: fulfilling },
];

describe("data requests (step 15a)", () => {
  it("export_subject refuses an unverified access request with not_verified and a deletion request with wrong_kind", async () => {
    await withRollback(async (db) => {
      await assertStep15a(db);
      const admin = await createStaffUser(db, ["admin"]);
      const access = await subjectRequest(db, `subject+${randomUUID()}@example.invalid`, "access");
      await db.query(STATUS, [access, "start_verification", admin, null]);
      const deletion = await subjectRequest(
        db,
        `subject+${randomUUID()}@example.invalid`,
        "deletion",
      );
      expect({
        unverified: await attempt(db, EXPORT, [access, admin]),
        deletion: await attempt(db, EXPORT, [deletion, admin]),
      }).toEqual({ unverified: "P0001 not_verified", deletion: "P0001 wrong_kind" });
    });
  });

  it("after confirm_identity, export_subject returns the subscriber, the inquiry, the contact and both submissions, and fulfils the request", async () => {
    await withRollback(async (db) => {
      await assertStep15a(db);
      const admin = await createStaffUser(db, ["admin"]);
      const email = `subject+${randomUUID()}@example.invalid`;
      const { inquiry, submissions } = await personRows(db, email);
      const request = await subjectRequest(db, email.toUpperCase(), "access");
      await confirmIdentity(db, request, admin);
      const { bundle } = await one<{
        bundle: {
          subscribers: { email: string }[];
          inquiries: { id: string }[];
          contacts: { email: string }[];
          submissions: { id: string }[];
        };
      }>(db, EXPORT, [request, admin]);
      const after = await one<{ status: string; handled_by: string; fulfilled: boolean }>(
        db,
        "select status, handled_by, fulfilled_at is not null as fulfilled from public.subject_requests where id = $1",
        [request],
      );
      expect({
        subscribers: bundle.subscribers.map((row) => row.email),
        inquiries: bundle.inquiries.map((row) => row.id),
        contacts: bundle.contacts.map((row) => row.email),
        submissions: bundle.submissions.map((row) => row.id).sort(),
        after,
        audit: await subjectAudit(db, request),
      }).toEqual({
        subscribers: [email],
        inquiries: [inquiry],
        contacts: [email],
        submissions: [...submissions].sort(),
        after: { status: "fulfilled", handled_by: admin, fulfilled: true },
        audit: auditTrail("audit.subject_export"),
      });
    });
  });

  it("delete_subject leaves no plaintext address, archives the contact, anonymises the inquiry and drops the dead webhook job's body", async () => {
    await withRollback(async (db) => {
      await assertStep15a(db);
      const admin = await createStaffUser(db, ["admin"]);
      const email = `subject+${randomUUID()}@example.invalid`;
      const { inquiry } = await personRows(db, email);
      const { id: job } = await one<{ id: string }>(
        db,
        `insert into public.jobs (type, idempotency_key, status, payload, result)
         values ('webhook_omnikom', $1, 'dead', jsonb_build_object('data', jsonb_build_object('inquiry_id', $2::text)),
           jsonb_build_object('body', $3::text, 'status', 500)) returning id`,
        [`webhook_omnikom:${inquiry}:test`, inquiry, JSON.stringify({ email })],
      );
      const request = await subjectRequest(db, email, "deletion");
      await confirmIdentity(db, request, admin);
      await db.query(DELETE, [request, admin]);
      const left = await one<Record<string, number>>(
        db,
        `select
           (select count(*)::int from public.subscribers where lower(email) = $1) as subscribers,
           (select count(*)::int from public.inquiries where lower(email) = $1) as inquiries,
           (select count(*)::int from public.contacts where lower(email) = $1) as contacts,
           (select count(*)::int from public.submissions where lower(submitter_email) = $1) as submissions,
           (select count(*)::int from public.audit_log
             where entity_id = $2::uuid
               and position($1 in coalesce(before::text, '') || coalesce(after::text, '') || coalesce(note, '')) > 0
           ) as audit`,
        [email, request],
      );
      const contact = await one<{ name: string; archived: boolean }>(
        db,
        `select name, archived_at is not null as archived from public.contacts
         where email = encode(sha256(convert_to($1, 'UTF8')), 'hex') || '@anonymised.invalid'`,
        [email],
      );
      const anonymised = await one<Record<string, unknown>>(
        db,
        `select anonymised_at is not null as anonymised, location, forwarded_payload, attribution, name, message
         from public.inquiries where id = $1`,
        [inquiry],
      );
      const { has_body } = await one<{ has_body: boolean }>(
        db,
        "select result ? 'body' as has_body from public.jobs where id = $1",
        [job],
      );
      expect({
        left,
        contact,
        anonymised,
        has_body,
        audit: await subjectAudit(db, request),
      }).toEqual({
        left: { subscribers: 0, inquiries: 0, contacts: 0, submissions: 0, audit: 0 },
        contact: { name: "", archived: true },
        anonymised: {
          anonymised: true,
          location: null,
          forwarded_payload: null,
          attribution: {},
          name: "",
          message: "",
        },
        has_body: false,
        audit: auditTrail("audit.subject_delete"),
      });
    });
  });

  it("opt_out_subject unsubscribes the subscriber, adds one manual suppression, and a second call raises wrong_state", async () => {
    await withRollback(async (db) => {
      await assertStep15a(db);
      const admin = await createStaffUser(db, ["admin"]);
      const email = `subject+${randomUUID()}@example.invalid`;
      await db.query("insert into public.subscribers (email, source) values ($1, 'home')", [email]);
      const request = await subjectRequest(db, email, "opt_out");
      await confirmIdentity(db, request, admin);
      await db.query(OPT_OUT, [request, admin]);
      const state = await one<{ unsubscribed: boolean; suppressions: string[] }>(
        db,
        `select (select unsubscribed_at is not null from public.subscribers where email = $1) as unsubscribed,
           (select array_agg(reason) from public.email_suppressions where email = $1) as suppressions`,
        [email],
      );
      expect({
        state,
        again: await attempt(db, OPT_OUT, [request, admin]),
        audit: await subjectAudit(db, request),
      }).toEqual({
        state: { unsubscribed: true, suppressions: ["manual"] },
        again: "P0001 wrong_state",
        audit: auditTrail("audit.subject_opt_out"),
      });
    });
  });

  it("fulfil_correction without a note raises note_required, and with a note fulfils the correction with one audit.subject_status row", async () => {
    await withRollback(async (db) => {
      await assertStep15a(db);
      const admin = await createStaffUser(db, ["admin"]);
      const request = await subjectRequest(
        db,
        `subject+${randomUUID()}@example.invalid`,
        "correction",
      );
      await confirmIdentity(db, request, admin);
      const without = await attempt(db, STATUS, [request, "fulfil_correction", admin, null]);
      await db.query(STATUS, [request, "fulfil_correction", admin, "Phone corrected by hand."]);
      const after = await one<{ status: string; handled_by: string; fulfilled: boolean }>(
        db,
        "select status, handled_by, fulfilled_at is not null as fulfilled from public.subject_requests where id = $1",
        [request],
      );
      expect({ without, after, audit: await subjectAudit(db, request) }).toEqual({
        without: "P0001 note_required",
        after: { status: "fulfilled", handled_by: admin, fulfilled: true },
        audit: auditTrail("audit.subject_status"),
      });
    });
  });
});
