import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { goalLine, nextGoalStep, shouldContinue } from "../../scripts/matter/live";
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
  it("is handed the next step only when idle, a minute after his answer, and at most every ten minutes", () => {
    const at = 1_000_000_000;
    expect([
      shouldContinue({ idle: true, now: at, lastResultAt: at - 60_000, goalAt: at - 600_000 }),
      shouldContinue({ idle: false, now: at, lastResultAt: at - 60_000, goalAt: at - 600_000 }),
      shouldContinue({ idle: true, now: at, lastResultAt: at - 59_999, goalAt: at - 600_000 }),
      shouldContinue({ idle: true, now: at, lastResultAt: at - 60_000, goalAt: at - 599_999 }),
    ]).toEqual([true, false, false, false]);
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
