import pg from "pg";
import { describe, expect, it } from "vitest";
import { asRole, createStaffUser, dbNow, withRollback, type Db } from "../fixtures/db";

async function failureOf(run: Promise<unknown>): Promise<{ message: string; where: string }> {
  try {
    await run;
  } catch (error) {
    if (error instanceof pg.DatabaseError) {
      return { message: error.message, where: error.where ?? "" };
    }
    throw error;
  }
  throw new Error("the statement succeeded");
}

// Invariant 3: append-only and kept forever, for the service role too (RLS would not bind it).
describe("audit_log", () => {
  const statements = {
    update: "update public.audit_log set note = 'x' where id = $1",
    delete: "delete from public.audit_log where id = $1",
  };
  it.each([
    { op: "update", as: "service_role" },
    { op: "delete", as: "service_role" },
    { op: "update", as: "postgres" },
    { op: "delete", as: "postgres" },
  ] as const)("audit_log refuses $op as $as", async ({ op, as }) => {
    const failure = await withRollback(async (db: Db) => {
      const inserted = await db.query<{ id: string }>(
        "insert into public.audit_log (action, entity) values ('test.probe', 'probe') returning id",
      );
      if (as === "service_role") await asRole(db, "service_role");
      return failureOf(db.query(statements[op], [inserted.rows[0]?.id]));
    });
    expect({
      message: failure.message,
      fromTrigger: failure.where.includes("audit_log_immutable"),
    }).toEqual({
      message: "append_only",
      fromTrigger: true,
    });
  });
});

describe("updated_at", () => {
  it("set_updated_at stamps the transaction's now() over any value written", async () => {
    const { stamped, now } = await withRollback(async (db: Db) => {
      const id = await createStaffUser(db, ["admin"]);
      const result = await db.query<{ updated_at: Date }>(
        "update public.user_roles set display_name = 'x', updated_at = '2000-01-01' where user_id = $1 returning updated_at",
        [id],
      );
      return { stamped: result.rows[0]?.updated_at.getTime(), now: (await dbNow(db)).getTime() };
    });
    expect(stamped).toBe(now);
  });
});
