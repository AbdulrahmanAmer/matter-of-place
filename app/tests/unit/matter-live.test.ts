import { mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { workforceConfig } from "../../scripts/workforce/config";
import { liveAlive } from "../../scripts/matter/live-alive";
import {
  isIdle,
  liveArgs,
  nextSession,
  openTasks,
  postableText,
  readStreamLine,
  shouldRotate,
} from "../../scripts/matter/live";

// W5 item 1: Matter's live session (operator, 2026-10-13: "work and keep building ... with status update ... if I text
// him mid-work ... he replies to me and he can get back to working"; Jay's rotation and alive conditions).

describe("the live session's command line", () => {
  it("streams both ways at full power, resumes a kept session, and refuses rather than asks", () => {
    const fresh = liveArgs(null);
    const resumed = liveArgs("s-1");
    expect({
      stream: [
        fresh.includes("--input-format"),
        fresh.filter((arg) => arg === "stream-json").length,
      ],
      full: fresh.some((arg) => arg.endsWith("settings-full.json")),
      json: fresh.includes("json"),
      resume: [fresh.includes("--resume"), resumed.slice(-2)],
      dontAsk: fresh[fresh.indexOf("--permission-mode") + 1],
    }).toEqual({
      stream: [true, 2],
      full: true,
      json: false,
      resume: [false, ["--resume", "s-1"]],
      dontAsk: "dontAsk",
    });
  });
});

describe("the stream the supervisor reads", () => {
  it("turns assistant text, a tool call, a background task and the result into events", () => {
    const assistant = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "Starting the tests in the background." },
          {
            type: "tool_use",
            name: "Bash",
            input: { command: "bun run check", run_in_background: true },
          },
        ],
      },
    });
    const task = JSON.stringify({
      type: "system",
      subtype: "task_started",
      task_id: "t1",
      description: "bun run check",
    });
    const done = JSON.stringify({ type: "system", subtype: "task_notification", task_id: "t1" });
    const result = JSON.stringify({
      type: "result",
      result: "Done.",
      session_id: "s-9",
      is_error: false,
    });
    expect([
      readStreamLine(assistant),
      readStreamLine(task),
      readStreamLine(done)[0],
      readStreamLine(result),
      readStreamLine("not json")[0]?.kind,
    ]).toEqual([
      [
        { kind: "text", text: "Starting the tests in the background." },
        { kind: "tool", name: "Bash", label: "Bash: bun run check" },
      ],
      [{ kind: "task", state: "started", id: "t1", label: "bun run check" }],
      { kind: "task", state: "done", id: "t1", label: "a background task" },
      [{ kind: "result", text: "Done.", session: "s-9", isError: false }],
      "other",
    ]);
  });

  it("posts what Matter says without the closing object", () => {
    expect([
      postableText('Filed.\n{"reply": "Filed it.", "task": "x"}'),
      postableText("Working on the migration now."),
    ]).toEqual(["Filed it.", "Working on the migration now."]);
  });
});

describe("rotation and the heartbeat", () => {
  it("rotates a session after six turns or a day, and counts turns on the same session", () => {
    const now = new Date("2026-10-13T10:00:00Z");
    const first = nextSession(null, "s-1", now);
    const second = nextSession(first, "s-1", now);
    const other = nextSession(second, "s-2", now);
    expect({
      counts: [first.turns, second.turns, other.turns],
      rotate: [
        shouldRotate({ ...second, turns: 5 }, now.getTime()),
        shouldRotate({ ...second, turns: 6 }, now.getTime()),
        shouldRotate({ ...second, startedAt: "2026-10-12T09:00:00Z" }, now.getTime()),
        shouldRotate(null, now.getTime()),
      ],
    }).toEqual({ counts: [1, 2, 1], rotate: [false, true, true, false] });
  });

  it("calls the supervisor alive only while its heartbeat is under a minute old", () => {
    const file = join(mkdtempSync(join(tmpdir(), "mop-live-")), "live.heartbeat");
    writeFileSync(file, "x");
    const fresh = liveAlive(file);
    const old = new Date(Date.now() - 120_000);
    utimesSync(file, old, old);
    expect([fresh, liveAlive(file), liveAlive(join(tmpdir(), "no-such-heartbeat"))]).toEqual([
      true,
      false,
      false,
    ]);
  });
});

describe("the laptop's switches", () => {
  it("uses the file's model and backlog until its date, and the defaults after it or without a file", () => {
    const file = join(mkdtempSync(join(tmpdir(), "mop-config-")), "config.json");
    writeFileSync(
      file,
      JSON.stringify({
        matterModel: "claude-sonnet-5-5",
        backlog: false,
        until: "2026-10-17T07:00:00+03:00",
      }),
    );
    expect([
      workforceConfig(file, new Date("2026-10-13T10:00:00Z")),
      workforceConfig(file, new Date("2026-10-17T05:00:00Z")),
      workforceConfig(join(tmpdir(), "no-such-config.json")),
    ]).toEqual([
      { matterModel: "claude-sonnet-5-5", backlog: false },
      { matterModel: "claude-opus-5-5", backlog: true },
      { matterModel: "claude-opus-5-5", backlog: true },
    ]);
  });
});

describe("a background task keeps the session busy (2026-10-13, a rotation dropped a running W4 check)", () => {
  it("opens a task on its start and closes it on its finish, and is idle only with nothing open", () => {
    const started = openTasks(new Set(), { id: "t-1", label: "bun run check", state: "started" });
    const second = openTasks(started, { id: "t-2", label: "tests", state: "started" });
    const oneDone = openTasks(second, { id: "t-1", label: "bun run check", state: "done" });
    const allDone = openTasks(oneDone, { id: "t-2", label: "tests", state: "done" });
    expect([...oneDone]).toEqual(["t-2"]);
    expect([isIdle(0, oneDone.size), isIdle(0, allDone.size), isIdle(1, 0)]).toEqual([
      false,
      true,
      false,
    ]);
  });
});
