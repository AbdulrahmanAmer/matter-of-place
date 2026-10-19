// W6 item 4: record_build_lesson, the one write of Matter's lessons from building. One row per merged pull request,
// source 'build', evidence 'pr:<number>', for the agent named; written once however often the merge is read; callable
// by the laptop runner's service role only.
import { describe, expect, it } from "vitest";
import { asRole, withRollback, type Db } from "../fixtures/db";

const TRIGGER = 'A build like "Carousel render" failed CI at knip';
const ACTION =
  "What broke: unused export. What fixed it: removed it. Check for this before you push.";

async function matterId(db: Db): Promise<string> {
  const read = await db.query<{ id: string }>("select id from public.agents where slug = 'matter'");
  const id = read.rows[0]?.id;
  if (id === undefined) throw new Error("no agent matter");
  return id;
}

const record = "select public.record_build_lesson($1, $2, $3, $4) as written";

describe("record_build_lesson", () => {
  it("writes the lesson for Matter with source build and the pull request as evidence", async () => {
    const rows = await withRollback(async (db) => {
      const agent = await matterId(db);
      await asRole(db, "service_role");
      const written = await db.query<{ written: boolean }>(record, [agent, 464, TRIGGER, ACTION]);
      await db.query("reset role");
      const read = await db.query<{
        agent_id: string;
        source: string;
        evidence_ref: string;
        status: string;
        uses: number;
        trigger: string;
        action: string;
      }>(
        "select agent_id, source, evidence_ref, status, uses, trigger, action from public.agent_lessons where source = 'build'",
      );
      return { agent, written: written.rows[0]?.written, rows: read.rows };
    });
    expect(rows.written).toBe(true);
    expect(rows.rows).toEqual([
      {
        agent_id: rows.agent,
        source: "build",
        evidence_ref: "pr:464",
        status: "active",
        uses: 0,
        trigger: TRIGGER,
        action: ACTION,
      },
    ]);
  });

  it("writes a pull request once however often its merge is read, and each pull request once", async () => {
    const outcome = await withRollback(async (db) => {
      const agent = await matterId(db);
      const first = await db.query<{ written: boolean }>(record, [agent, 464, TRIGGER, ACTION]);
      const again = await db.query<{ written: boolean }>(record, [agent, 464, TRIGGER, "Another"]);
      const other = await db.query<{ written: boolean }>(record, [agent, 465, TRIGGER, ACTION]);
      const count = await db.query<{ n: string }>(
        "select count(*) as n from public.agent_lessons where source = 'build'",
      );
      return {
        written: [first, again, other].map((result) => result.rows[0]?.written),
        count: count.rows[0]?.n,
      };
    });
    expect(outcome).toEqual({ written: [true, false, true], count: "2" });
  });

  it("refuses a missing pull request number, an unknown agent and words past the columns' limits", async () => {
    const refusals = await withRollback(async (db) => {
      const agent = await matterId(db);
      const attempt = async (args: unknown[]): Promise<string> => {
        await db.query("savepoint attempt");
        try {
          await db.query(record, args);
          return "no error";
        } catch (error) {
          return error instanceof Error ? error.message : String(error);
        } finally {
          await db.query("rollback to savepoint attempt");
        }
      };
      return [
        await attempt([agent, 0, TRIGGER, ACTION]),
        await attempt(["00000000-0000-0000-0000-000000000000", 464, TRIGGER, ACTION]),
        await attempt([agent, 464, "x".repeat(301), ACTION]),
        await attempt([agent, 464, TRIGGER, "x".repeat(1001)]),
      ];
    });
    expect(refusals[0]).toBe("validation");
    expect(refusals[1]).toBe("not_found");
    expect(refusals[2]).toContain("agent_lessons_trigger_check");
    expect(refusals[3]).toContain("agent_lessons_action_check");
  });

  it("answers the service role and refuses anon and authenticated", async () => {
    const outcomes = await withRollback(async (db) => {
      const agent = await matterId(db);
      const results: Record<string, string> = {};
      for (const role of ["service_role", "anon", "authenticated"] as const) {
        await db.query("savepoint probe");
        await asRole(db, role);
        try {
          await db.query(record, [agent, 470, TRIGGER, ACTION]);
          results[role] = "ok";
        } catch (error) {
          results[role] = error instanceof Error ? error.message : "unknown error";
        }
        await db.query("rollback to savepoint probe");
      }
      return results;
    });
    expect(outcomes).toEqual({
      service_role: "ok",
      anon: "permission denied for function record_build_lesson",
      authenticated: "permission denied for function record_build_lesson",
    });
  });

  it("keeps the other sources and refuses a source the table does not know", async () => {
    const outcome = await withRollback(async (db) => {
      const agent = await matterId(db);
      const insert = (source: string) =>
        db.query(
          `insert into public.agent_lessons (agent_id, trigger, action, evidence_ref, source)
           values ($1, 'a trigger', 'an action', 'x', $2)`,
          [agent, source],
        );
      for (const source of ["decline", "edit", "outcome", "matter", "build"]) await insert(source);
      await db.query("savepoint attempt");
      try {
        await insert("guess");
        return "no error";
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    });
    expect(outcome).toContain("agent_lessons_source_check");
  });
});
