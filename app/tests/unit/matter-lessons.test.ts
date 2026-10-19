import { describe, expect, it, vi } from "vitest";
import type { Db } from "../../src/server/lib/db";
import {
  buildLesson,
  markUsed,
  mergedByRun,
  mergeGatePr,
  recallForMatter,
  recordBuildLesson,
  recordBuildLessons,
  stillPending,
  type Gh,
} from "../../scripts/matter/lessons";
import { readStreamLine } from "../../scripts/matter/live";
import { matterPrompt } from "../../scripts/matter/run";
import { readJsonAnswer } from "../../scripts/workforce/answer";
import { lessonsBlock, type Lesson } from "../../scripts/workforce/growth";

// W6 item 4: Matter's lessons from building. A merged pull request that failed CI writes one lesson (what broke, what
// fixed it); the next build prompt quotes it through the same recall as the operator's decisions.

const TITLE = "Carousel render in the build worker";
const VIEW = JSON.stringify({
  number: 464,
  title: TITLE,
  state: "MERGED",
  commits: [
    { oid: "aaa", messageHeadline: "Render carousels in the worker" },
    { oid: "bbb", messageHeadline: "Fix the unused export knip found" },
    { oid: "ccc", messageHeadline: "Format with the app's config" },
  ],
});

/** GitHub as it answered for pull request 464: the first commit failed lint and knip, the others passed. */
function github(overrides: Partial<Record<"view" | "runs" | "notes", string | null>> = {}): Gh {
  return vi.fn(async (args: string[]) => {
    const [first, second] = args;
    if (first === "pr") return overrides.view === undefined ? VIEW : overrides.view;
    if (second?.includes("/commits/aaa/check-runs"))
      return overrides.runs === undefined
        ? JSON.stringify([
            { id: 11, name: "check" },
            { id: 12, name: "knip" },
          ])
        : overrides.runs;
    if (second?.includes("/commits/")) return "[]";
    if (second?.includes("/check-runs/11/annotations"))
      return overrides.notes === undefined
        ? JSON.stringify(["", "Unused export: screenshotPath in scripts/render.ts"])
        : overrides.notes;
    return "[]";
  });
}

function fakeDb(written: boolean | { message: string } = true) {
  const rpc = vi.fn(async (_name: string, _args: Record<string, unknown>) =>
    typeof written === "boolean"
      ? { data: written, error: null }
      : { data: null, error: { message: written.message } },
  );
  return { db: { rpc } as unknown as Db, rpc };
}

describe("the merge Matter made", () => {
  it("reads the pull request from the gate command and from nothing else", () => {
    expect([
      mergeGatePr("node workspace/05-plans/merge-gate.mjs 464"),
      mergeGatePr(
        "cd ../matter-desk && node workspace/05-plans/merge-gate.mjs 7 --local-ci log.md",
      ),
      mergeGatePr("gh pr merge 464 --merge"),
      mergeGatePr("node workspace/05-plans/merge-gate.mjs"),
    ]).toEqual([464, 7, null, null]);
  });

  it("is carried by the tool event of the live stream", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            name: "Bash",
            input: { command: "node workspace/05-plans/merge-gate.mjs 464" },
          },
        ],
      },
    });
    expect(readStreamLine(line)).toEqual([
      {
        kind: "tool",
        name: "Bash",
        label: "Bash: node workspace/05-plans/merge-gate.mjs 464",
        merged: 464,
      },
    ]);
  });

  it("is named in the closing object of a one-shot run", () => {
    expect(readJsonAnswer('Merged it.\n{"reply": "Merged.", "merged": [464, 465]}').merged).toEqual(
      [464, 465],
    );
    expect(readJsonAnswer('{"reply": "Nothing merged."}').merged).toBeUndefined();
  });
});

describe("who may name a merge", () => {
  it("is Matter at full power only; a colleague, or Matter woken by outside text, names none", () => {
    expect([
      mergedByRun(true, "full", [464]),
      mergedByRun(true, "full", undefined),
      mergedByRun(true, "read", [464]),
      mergedByRun(false, "full", [464]),
    ]).toEqual([[464], [], [], []]);
  });
});

describe("the lesson of a pull request", () => {
  it("says what broke and what fixed it, from the first failure on", () => {
    const lesson = buildLesson(
      {
        title: TITLE,
        subjects: ["Render carousels in the worker", "Fix the unused export knip found", "Format"],
      },
      [
        { commit: 0, job: "check", note: "" },
        { commit: 0, job: "knip", note: "Unused export: screenshotPath" },
      ],
    );
    expect(lesson).toEqual({
      trigger: `A build like "${TITLE}" failed CI at check, knip`,
      action:
        "What broke: Unused export: screenshotPath. What fixed it: Fix the unused export knip found; Format. Check for this before you push.",
    });
  });

  it("writes nothing for a pull request CI never failed", () => {
    expect(buildLesson({ title: TITLE, subjects: ["Only commit"] }, [])).toBeNull();
  });

  it("stays inside the columns' limits however long CI's words are", () => {
    const lesson = buildLesson(
      { title: "t".repeat(500), subjects: ["a", "b".repeat(500), "c".repeat(500), "d", "e", "f"] },
      [{ commit: 0, job: "j".repeat(400), note: "n".repeat(900) }],
    );
    expect(lesson?.trigger.length).toBeLessThanOrEqual(300);
    expect(lesson?.action.length).toBeLessThanOrEqual(1000);
  });
});

describe("recording it", () => {
  it("writes one lesson for Matter through record_build_lesson", async () => {
    const { db, rpc } = fakeDb();
    expect(await recordBuildLesson(db, "matter-id", 464, github())).toBe("recorded");
    expect(rpc).toHaveBeenCalledTimes(1);
    const [name, args] = rpc.mock.calls[0] ?? [];
    expect(name).toBe("record_build_lesson");
    expect(args).toMatchObject({ p_agent: "matter-id", p_pr: 464 });
    expect(String(args?.["p_trigger"])).toContain(TITLE);
    expect(String(args?.["p_action"])).toContain(
      "What broke: Unused export: screenshotPath in scripts/render.ts",
    );
    expect(String(args?.["p_action"])).toContain(
      "What fixed it: Fix the unused export knip found; Format with the app's config",
    );
  });

  it("says when the lesson was already there, and writes nothing twice", async () => {
    const { db } = fakeDb(false);
    expect(await recordBuildLesson(db, "matter-id", 464, github())).toBe("recorded before");
  });

  it("asks GitHub whether the pull request is merged and trusts nothing else", async () => {
    const { db, rpc } = fakeDb();
    const open = JSON.stringify({ ...JSON.parse(VIEW), state: "OPEN" });
    expect(await recordBuildLesson(db, "matter-id", 464, github({ view: open }))).toBe(
      "not merged",
    );
    expect(await recordBuildLesson(db, "matter-id", 464, github({ view: null }))).toBe(
      "unreadable",
    );
    expect(await recordBuildLesson(db, "matter-id", 464, github({ view: "{}" }))).toBe(
      "unreadable",
    );
    expect(rpc).not.toHaveBeenCalled();
  });

  it("writes no row when CI never failed on the way", async () => {
    const { db, rpc } = fakeDb();
    expect(await recordBuildLesson(db, "matter-id", 464, github({ runs: "[]" }))).toBe(
      "no CI failure",
    );
    expect(rpc).not.toHaveBeenCalled();
  });

  it("drops a lesson the database refuses without throwing", async () => {
    const { db } = fakeDb({ message: "validation" });
    expect(await recordBuildLesson(db, "matter-id", 464, github())).toBe("not written");
  });

  it("reads each number once and at most ten a run", async () => {
    const { db, rpc } = fakeDb();
    const lines = await recordBuildLessons(
      db,
      "matter-id",
      [464, 464, ...Array.from({ length: 12 }, (_, n) => 500 + n)],
      github(),
    );
    expect(lines).toHaveLength(10);
    expect(lines[0]).toBe("build lesson for pull request 464: recorded");
    expect(rpc).toHaveBeenCalledTimes(10);
  });

  it("asks again about a merge the gate has not finished, for half an hour", () => {
    const seen = Date.parse("2026-10-19T10:00:00Z");
    const at = (minutes: number) => seen + minutes * 60_000;
    expect([
      stillPending("not merged", seen, at(5)),
      stillPending("unreadable", seen, at(29)),
      stillPending("not merged", seen, at(31)),
      stillPending("recorded", seen, at(1)),
      stillPending("no CI failure", seen, at(1)),
    ]).toEqual([true, true, false, false, false]);
  });
});

const BUILD_ROW = {
  id: "b1",
  trigger: `A build like "${TITLE}" failed CI at knip`,
  action:
    "What broke: Unused export. What fixed it: removed the export. Check for this before you push.",
  uses: 2,
  last_used_at: null,
  created_at: "2026-10-18T08:00:00.000Z",
  source: "build",
};
const TAUGHT_ROW = {
  id: "t1",
  trigger: "When you draft a reply to an inquiry",
  action: "Keep it to three sentences.",
  uses: 0,
  last_used_at: null,
  created_at: "2026-10-17T08:00:00.000Z",
  source: "decline",
};

function lessonsDb(rows: unknown[]) {
  const update = vi.fn((_values: Record<string, unknown>) => ({ eq: vi.fn(async () => ({})) }));
  const or = vi.fn(async (_filter: string) => ({ data: rows, error: null }));
  const from = vi.fn((_table: string) => ({
    select: () => ({ eq: () => ({ or }) }),
    update,
  }));
  return { db: { from } as unknown as Db, or, update };
}

describe("recalling it in the next build", () => {
  it("shows Matter his builds' lessons apart from the operator's decisions", () => {
    const block = lessonsBlock([TAUGHT_ROW, BUILD_ROW]);
    expect(block).toContain("What the operator has taught you");
    expect(block).toContain("- When you draft a reply to an inquiry: Keep it to three sentences.");
    expect(block).toContain("What your own earlier builds taught you");
    expect(block).toContain(`- ${BUILD_ROW.trigger}: ${BUILD_ROW.action}`);
    expect(lessonsBlock([BUILD_ROW])).not.toContain("What the operator has taught you");
  });

  it("reads his own lessons and the team's, and counts the ones shown", async () => {
    const { db, or, update } = lessonsDb([TAUGHT_ROW, BUILD_ROW]);
    const { shown, block } = await recallForMatter(db, "matter-id", "");
    expect(or).toHaveBeenCalledWith("agent_id.eq.matter-id,agent_id.is.null");
    expect(shown.map((lesson: Lesson) => lesson.id)).toEqual(["b1", "t1"]);
    await markUsed(db, shown);
    expect(update).toHaveBeenCalledTimes(2);
    expect(update.mock.calls[0]?.[0]).toMatchObject({ uses: 3 });
    expect(block).toContain(BUILD_ROW.action);
  });

  it("puts the recalled build lesson in the prompt Matter builds from", async () => {
    const { db } = lessonsDb([BUILD_ROW]);
    const { block } = await recallForMatter(db, "matter-id", "");
    const prompt = matterPrompt({
      charterText: "",
      atlasText: "",
      notes: "",
      thread: "Build the carousel worker.",
      business: block,
      power: "full",
    });
    expect(prompt).toContain("What your own earlier builds taught you");
    expect(prompt).toContain("What broke: Unused export. What fixed it: removed the export.");
    expect(
      matterPrompt({
        charterText: "",
        atlasText: "",
        notes: "",
        thread: "Build the carousel worker.",
        business: "",
        power: "full",
      }),
    ).not.toContain("earlier builds taught you");
  });
});
