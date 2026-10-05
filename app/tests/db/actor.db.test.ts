// DB-04, invariant 18: `write_audit` checks the actor as stored, inside the writing function's transaction, so a
// refused actor rolls the whole change back. Every case runs in one rolled-back transaction (F22).
import pg from "pg";
import { describe, expect, it } from "vitest";
import { createStaffUser, withRollback, type Db } from "../fixtures/db";

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

const audit = (db: Db, actor: string, kind: string, action: string) =>
  attempt(
    db,
    "select public.write_audit($1, $2::public.actor_kind, $3, 'probe', null, null, '{\"x\": 1}', 'req-actor')",
    [actor, kind, action],
  );

async function agent(db: Db, roles: string[]): Promise<string> {
  const id = await createStaffUser(db, roles);
  await db.query("update public.user_roles set actor_kind = 'agent' where user_id = $1", [id]);
  return id;
}

// Admin write functions that still insert into `audit_log` themselves; each owner moves to `write_audit` and takes
// its name off this list (R21). Read functions with a `p_actor` argument would also go here, and none exists yet.
const notThroughWriteAudit = [
  "approve_asset", // B9
  "reject_asset", // B9
  "rerender_asset", // B9
  "set_asset_caption", // B9
  "settings_put_site", // B16
];

describe("write_audit's actor check", () => {
  it("raises 42501 for an agent passed as human, and the writing function's change rolls back", async () => {
    await withRollback(async (db) => {
      const id = await agent(db, ["managing_editor"]);
      // A writer as every admin function is: change a row, then audit it, in one transaction.
      await db.query(`
        create function pg_temp.change_and_audit(p_actor uuid, p_actor_kind public.actor_kind) returns void
        language plpgsql as $$
        begin
          update public.settings set value = '{"probe": true}' where key = 'agent_daily_limits';
          perform public.write_audit(p_actor, p_actor_kind, 'submissions.decline', 'probe', null, null, null, 'req');
        end;
        $$`);
      const outcome = await attempt(db, "select pg_temp.change_and_audit($1, 'human')", [id]);
      const { value } = await one<{ value: unknown }>(
        db,
        "select value from public.settings where key = 'agent_daily_limits'",
      );
      expect(outcome).toBe("42501 forbidden");
      expect(value).not.toEqual({ probe: true });
      expect(await attempt(db, "select pg_temp.change_and_audit($1, 'agent')", [id])).toBe("ok");
    });
  });

  it("raises forbidden for a commercial user on inquiries.forward and lets an editor through", async () => {
    await withRollback(async (db) => {
      const commercial = await createStaffUser(db, ["commercial"]);
      const editor = await createStaffUser(db, ["managing_editor"]);
      expect([
        await audit(db, commercial, "human", "inquiries.forward"),
        await audit(db, editor, "human", "inquiries.forward"),
      ]).toEqual(["42501 forbidden", "ok"]);
    });
  });

  it("raises forbidden for a disabled user, an unknown user and an action with no action_roles row", async () => {
    await withRollback(async (db) => {
      const disabled = await createStaffUser(db, ["admin"]);
      await db.query("update public.user_roles set disabled_at = now() where user_id = $1", [
        disabled,
      ]);
      const admin = await createStaffUser(db, ["admin"]);
      expect([
        await audit(db, disabled, "human", "settings.get"),
        await audit(db, "00000000-0000-4000-8000-0000000000ff", "human", "settings.get"),
        await audit(db, admin, "human", "no.such_action"),
      ]).toEqual(["42501 forbidden", "42501 forbidden", "42501 forbidden"]);
    });
  });

  it("raises human_only for an agent on a human-only action its role covers", async () => {
    await withRollback(async (db) => {
      const id = await agent(db, ["admin"]);
      expect(await audit(db, id, "agent", "team.limits_put")).toBe("42501 human_only");
    });
  });

  it("is called by every public function with a p_actor argument, apart from the listed ones", async () => {
    await withRollback(async (db) => {
      const { rows } = await db.query<{ name: string }>(`
        select p.proname as name
        from pg_proc p
        where p.pronamespace = 'public'::regnamespace
          and 'p_actor' = any (p.proargnames)
          and p.proname <> 'write_audit'
          and position('write_audit(' in p.prosrc) = 0
        order by 1`);
      expect(rows.map((row) => row.name)).toEqual(notThroughWriteAudit);
    });
  });
});
