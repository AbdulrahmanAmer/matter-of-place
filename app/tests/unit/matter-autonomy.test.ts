import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  GOAL_GAP_MAX_MS,
  goalGapMs,
  goalLine,
  goalSkipReason,
  isWorkTool,
  nextGoalStep,
  quietAfter,
  youngTasks,
} from "../../scripts/matter/live";
import { readablePath } from "../../scripts/matter/read";
import { matterPrompt } from "../../scripts/matter/run";
import { decision } from "../../scripts/workforce/daemon";

// The operator, 2026-10-15: Matter runs the operation in his place. He merges through the gate, decides his own admin
// changes and his colleagues' approvals, keeps going on his goal without a person, and builds like a senior engineer.

const gate = join(process.cwd(), "..", ".claude", "hooks", "task-gate.mjs");

describe("Matter decides", () => {
  it("records a call from his live session as approved by him, and a read-only run's as waiting", () => {
    const now = new Date("2026-10-15T02:00:00Z");
    expect([decision(true, now), decision(false, now)]).toEqual([
      { state: "approved", decided_at: "2026-10-15T02:00:00.000Z", reason: "Decided by Matter" },
      {},
    ]);
  });

  it("is told he merges, decides approvals and builds the smallest change in the right place", () => {
    const prompt = matterPrompt({
      charterText: "",
      atlasText: "",
      notes: "",
      thread: "",
      business: "",
      power: "full",
    });
    expect({
      merges: prompt.includes(
        "merge it yourself through `node workspace/05-plans/merge-gate.mjs <pr>`",
      ),
      decides: prompt.includes("made at once with your key"),
      approvals: prompt.includes("POST /api/admin/workforce/approvals/$id"),
      senior: prompt.includes("Build the way a senior engineer would"),
      noPersonWait: prompt.includes("waits in Approvals until a person approves it"),
    }).toEqual({ merges: true, decides: true, approvals: true, senior: true, noPersonWait: false });
  });

  it("reads only admin API paths, even after Git Bash rewrote the leading slash", () => {
    expect([
      readablePath("/api/admin/workforce/approvals"),
      readablePath("C:/Program Files/Git/api/admin/workforce/approvals"),
      readablePath("/api/public/site"),
      readablePath("/api/admin/../secrets"),
      readablePath(undefined),
    ]).toEqual([
      "/api/admin/workforce/approvals",
      "/api/admin/workforce/approvals",
      null,
      null,
      null,
    ]);
  });
});

describe("Matter keeps going on his goal", () => {
  it("is handed the next step only with a session up and no line in hand, a minute after his answer, at most every ten minutes, and while the policy allows, and is told why not", () => {
    const at = 1_000_000_000;
    const ready = {
      hasSession: true,
      active: 0,
      now: at,
      lastResultAt: at - 60_000,
      goalAt: at - 600_000,
      backlog: "all" as const,
    };
    expect([
      goalSkipReason(ready),
      goalSkipReason({ ...ready, hasSession: false }),
      goalSkipReason({ ...ready, active: 1 }),
      goalSkipReason({ ...ready, lastResultAt: at - 59_999 }),
      goalSkipReason({ ...ready, goalAt: at - 599_999 }),
      goalSkipReason({ ...ready, backlog: "off" }),
      goalSkipReason({ ...ready, backlog: "person" }),
    ]).toEqual([
      null,
      "no live session is up",
      "1 line(s) in hand",
      "under a minute since his last answer",
      "under ten minutes since the last goal line",
      "the staff policy has self-started work off",
      null,
    ]);
  });

  // operator, 2026-10-27: 31 "nothing new, still waiting" lines in two hours, each a goal line re-handed every ten
  // minutes while his own builders ran
  it("waits while his own background work runs, and doubles the gap after each goal turn that did no work", () => {
    const at = 1_000_000_000;
    const ready = {
      hasSession: true,
      active: 0,
      now: at,
      lastResultAt: at - 60_000,
      goalAt: at - 600_000,
      backlog: "all" as const,
    };
    expect(goalSkipReason({ ...ready, open: 2 })).toBe(
      "2 background task(s) of his running; their end wakes him",
    );
    expect(goalSkipReason({ ...ready, open: 0, quiet: 0 })).toBeNull();
    expect(goalSkipReason({ ...ready, quiet: 1 })).toBe(
      "his last 1 goal turn(s) did no work; the next waits 20 minutes",
    );
    expect(goalSkipReason({ ...ready, quiet: 1, goalAt: at - 1_200_000 })).toBeNull();
    expect([0, 1, 2, 3, 9].map(goalGapMs)).toEqual([
      600_000,
      1_200_000,
      2_400_000,
      GOAL_GAP_MAX_MS,
      GOAL_GAP_MAX_MS,
    ]);
    expect(GOAL_GAP_MAX_MS).toBe(60 * 60_000);
  });

  it("counts a goal turn as work by its effect, and holds the goal back only for young background tasks", () => {
    // a status read before "nothing new" is no work; a file written, a builder or an agent started is
    expect(["Bash", "Read", "Grep", "Edit", "Write", "Agent", "Task"].map(isWorkTool)).toEqual([
      false,
      false,
      false,
      true,
      true,
      true,
      true,
    ]);
    const turn = { goalTurn: true, work: 0, quiet: 2, isError: false };
    expect([
      quietAfter(turn),
      quietAfter({ ...turn, work: 1 }),
      quietAfter({ ...turn, goalTurn: false }),
      quietAfter({ ...turn, isError: true }),
    ]).toEqual([3, 0, 2, 2]);
    const at = 10_000_000;
    const open = new Map([
      ["builder", at - 5 * 60_000],
      ["watcher", at - GOAL_GAP_MAX_MS],
    ]);
    expect(youngTasks(open, at)).toBe(1);
    expect(youngTasks(new Map(), at)).toBe(0);
  });

  it("names the first open step of his list, none when every step passes, none without a list", () => {
    const dir = mkdtempSync(join(tmpdir(), "goal-"));
    const open = join(dir, "open.json");
    const done = join(dir, "done.json");
    writeFileSync(
      open,
      JSON.stringify({
        goal: "g",
        steps: [
          { id: "1", title: "passes", check: { cmd: "exit 0" } },
          { id: "2", title: "the open one", check: { cmd: "exit 1" } },
        ],
      }),
    );
    writeFileSync(
      done,
      JSON.stringify({
        goal: "g",
        steps: [{ id: "1", title: "passes", check: { cmd: "exit 0" } }],
      }),
    );
    expect([
      nextGoalStep(open, gate)?.startsWith("2 the open one"),
      nextGoalStep(done, gate),
      nextGoalStep(join(dir, "missing.json"), gate),
    ]).toEqual([true, null, null]);
    expect(goalLine("2 the open one")).toContain("The next open step: 2 the open one");
    expect(readFileSync(gate, "utf8")).toContain("--stop");
  });
});
