// B7: the admin side of the database. Step 1: `write_audit`, the agent key lookups, `staff_can_sign_in`,
// `action_roles` and the agent daily caps (migration `admin_audit`, invariants 3, 18 and 19). Every case runs in one
// rolled-back transaction (F22).
import { randomUUID } from "node:crypto";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { asRole, createStaffUser, dbNow, withRollback, type Db } from "../fixtures/db";
import { createSubmission } from "../fixtures/factories";

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
