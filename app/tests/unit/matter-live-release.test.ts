import { describe, expect, it } from "vitest";
import type { Db } from "../../src/server/lib/db";
import { goalLine, goalTurn, isLostSession, releaseHeld } from "../../scripts/matter/live";

// 2026-10-27: a goal run lost when Matter's supervisor restarted sat `running` for five hours under a six-hour lease.
// A new supervisor lets go of what its worker still holds: a person's line back to the queue, a goal run closed.
type Row = { id: string; worker: string | null; state: string; cause: string; error?: string };

function fakeRuns(rows: Row[]): Db {
  const from = () => {
    let change: Partial<Row> = {};
    const tests: ((row: Row) => boolean)[] = [];
    const chain = {
      update(next: Partial<Row>) {
        change = next;
        return chain;
      },
      eq(column: keyof Row, value: string) {
        tests.push((row) => row[column] === value);
        return chain;
      },
      neq(column: keyof Row, value: string) {
        tests.push((row) => row[column] !== value);
        return chain;
      },
      select() {
        const hit = rows.filter((row) => tests.every((test) => test(row)));
        for (const row of hit) Object.assign(row, change);
        return Promise.resolve({ data: hit.map(({ id }) => ({ id })), error: null });
      },
    };
    return chain;
  };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- a client of agent_runs updates only; the code under test touches nothing else
  return { from } as unknown as Db;
}

describe("releaseHeld", () => {
  it("puts a person's line back in the queue and closes a goal run, under its own worker only", async () => {
    const rows: Row[] = [
      { id: "line", worker: "matter-live@x", state: "running", cause: "message" },
      { id: "goal", worker: "matter-live@x", state: "running", cause: "schedule" },
      { id: "done", worker: "matter-live@x", state: "done", cause: "schedule" },
      { id: "other", worker: "x:123", state: "running", cause: "schedule" },
      // a line another worker is answering, and one this worker already answered: neither is answered again
      { id: "other-line", worker: "x:123", state: "running", cause: "message" },
      { id: "answered", worker: "matter-live@x", state: "done", cause: "message" },
    ];
    expect(await releaseHeld(fakeRuns(rows), "matter-live@x")).toEqual({ requeued: 1, closed: 1 });
    expect(rows.find((row) => row.id === "line")).toMatchObject({ state: "queued", worker: null });
    const goal = rows.find((row) => row.id === "goal");
    expect(goal?.state).toBe("failed");
    expect(goal?.error).toContain("supervisor restarted");
    expect(rows.find((row) => row.id === "done")?.state).toBe("done");
    expect(rows.find((row) => row.id === "other")?.state).toBe("running");
    expect(rows.find((row) => row.id === "other-line")).toMatchObject({
      state: "running",
      worker: "x:123",
    });
    expect(rows.find((row) => row.id === "answered")?.state).toBe("done");
    // P-3450: live.ts loads the runner (daemon.ts) cold
  }, 30_000);
});

describe("isLostSession", () => {
  const live =
    "claude.exe -p --settings E:\\mop-build\\live\\app\\scripts\\matter\\settings-full.json --input-format stream-json --output-format stream-json --verbose";
  it("knows the session a supervisor before this one started, and never the desktop app's or a newer process", () => {
    expect(isLostSession(live, 1_000, 2_000)).toBe(true);
    // the desktop app's sessions take stream input too, without Matter's settings
    expect(
      isLostSession(
        "claude.exe -p --input-format stream-json --output-format stream-json --verbose",
        1_000,
        2_000,
      ),
    ).toBe(false);
    // a builder Matter starts carries his settings but no stream input
    expect(
      isLostSession(
        "claude.exe -p --settings E:\\mop-build\\live\\app\\scripts\\matter\\settings-full.json --model opus",
        1_000,
        2_000,
      ),
    ).toBe(false);
    // the id was saved before this process started: Windows reused it
    expect(isLostSession(live, 3_000, 2_000)).toBe(false);
  });
});

describe("goalTurn", () => {
  it("hands the sweep's stall report first, then the goal step, and nothing when there is neither", () => {
    expect(goalTurn("", "W8 0k")).toBe(goalLine("W8 0k"));
    expect(goalTurn("", null)).toBeNull();
    expect(goalTurn("ended a studio pass", null)).toBe(
      "MOP Sweep's stall report (said once):\nended a studio pass",
    );
    expect(goalTurn("ended a studio pass", "W8 0k")).toBe(
      `MOP Sweep's stall report (said once):\nended a studio pass\n\n${goalLine("W8 0k")}`,
    );
  });
});
