// Ruling H151: an agent account may hold a sign-in token now (Matter signs in to the admin from the laptop), and that
// token grants nothing through row-level security. The policy helpers answer only for a person: a role row of kind
// human on an account that never held a key. A person's answers are unchanged (harness.db.test.ts).
import { describe, expect, it } from "vitest";
import { asRole, createStaffUser, withRollback, type Db } from "../fixtures/db";

const ROLE_ANSWERS =
  "select app.role_in('admin') as admin, app.is_staff() as staff, (select count(*)::int from public.user_roles) as visible";

interface Answers {
  admin: boolean;
  staff: boolean;
  visible: number;
}

async function answersAs(db: Db, id: string): Promise<Answers | undefined> {
  await asRole(db, "authenticated", id);
  return (await db.query<Answers>(ROLE_ANSWERS)).rows[0];
}

describe("an agent account's own token (H151)", () => {
  it("holds no role, is not staff and reads no role row, when its rows say agent", async () => {
    const answers = await withRollback(async (db) => {
      const id = await createStaffUser(db, ["admin"]);
      await db.query("update public.user_roles set actor_kind = 'agent' where user_id = $1", [id]);
      return answersAs(db, id);
    });
    expect(answers).toEqual({ admin: false, staff: false, visible: 0 });
  });

  it("holds no role and is not staff when it holds a key, though its rows say person", async () => {
    const answers = await withRollback(async (db) => {
      const id = await createStaffUser(db, ["admin"]);
      await db.query(
        "insert into public.agent_keys (user_id, key_hash, label, scopes) values ($1, md5(random()::text), 'probe', '{}')",
        [id],
      );
      return answersAs(db, id);
    });
    expect(answers).toEqual({ admin: false, staff: false, visible: 0 });
  });

  it("holds no role through its person row when another of its rows says agent (mixed rows)", async () => {
    const answers = await withRollback(async (db) => {
      const id = await createStaffUser(db, ["admin", "chief_editor"]);
      await db.query(
        "update public.user_roles set actor_kind = 'agent' where user_id = $1 and role = 'chief_editor'",
        [id],
      );
      return answersAs(db, id);
    });
    expect(answers).toEqual({ admin: false, staff: false, visible: 0 });
  });

  it("is not counted as the other admin by is_last_admin when it holds a key", async () => {
    const last = await withRollback(async (db) => {
      const person = await createStaffUser(db, ["admin"]);
      // A second admin whose rows say person but who holds a key, and every seeded admin given a key too, so only
      // the account test can tell the person from the rest.
      await createStaffUser(db, ["admin"]);
      await db.query(
        `insert into public.agent_keys (user_id, key_hash, label, scopes)
         select r.user_id, md5(random()::text), 'probe', '{}' from public.user_roles r
         where r.role = 'admin' and r.user_id <> $1`,
        [person],
      );
      return (
        await db.query<{ last: boolean }>("select public.is_last_admin($1) as last", [person])
      ).rows[0]?.last;
    });
    expect(last).toBe(true);
  });

  it("leaves a person admin an admin who reads the role rows", async () => {
    const answers = await withRollback(async (db) => {
      const id = await createStaffUser(db, ["admin"]);
      return answersAs(db, id);
    });
    expect(answers).toMatchObject({ admin: true, staff: true });
    expect(answers?.visible).toBeGreaterThan(0);
  });
});
