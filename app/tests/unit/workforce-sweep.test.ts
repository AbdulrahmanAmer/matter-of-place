import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { STALE_MS } from "../../scripts/workforce/reel.ts";
import {
  FFMPEG_CAP_MS,
  PASS_CAP_MS,
  planSweep,
  report,
  reportKey,
  returnOrphanedPieces,
  RUN_CEILING_MS,
  runnerWorker,
  waitingPieces,
  WAIT_MS,
  type Proc,
} from "../../scripts/workforce/sweep.ts";

// Operator, 2026-10-27: "make sure that they are able to check if things are stuck and clean behind them". The sweep
// ends what nobody waits for, from one process listing; these cases are the stacks the laptop actually had.
const NOW = Date.parse("2026-10-27T15:00:00Z");
const ago = (minutes: number) => NOW - minutes * 60_000;
const proc = (
  pid: number,
  parent: number,
  name: string,
  startedMinAgo: number,
  command = "",
): Proc => ({
  pid,
  parent,
  name,
  started: ago(startedMinAgo),
  command,
});

const SHELL =
  'cmd.exe /c cd /d "E:\\mop-build\\live\\app" && bun scripts\\workforce\\daemon.ts >> "C:\\Users\\DELL\\.mop-workforce\\daemon.log" 2>&1';
const DAEMON = "bun  scripts\\workforce\\daemon.ts";
const PASS = 'bun "E:\\mop-build\\live\\app\\scripts\\workforce\\reel.ts" --pass';
const COLLEAGUE =
  "claude -p --model sonnet --mcp-config C:\\Users\\DELL\\.mop-workforce\\no-mcp.json --permission-mode dontAsk";
const LIVE_CLI =
  "claude -p --settings E:\\mop-build\\live\\app\\scripts\\matter\\settings-full.json --input-format stream-json --output-format stream-json";
const BUILDER =
  "claude -p --settings E:/mop-build/live/app/scripts/matter/settings-full.json --model opus";
const ended = (procs: Proc[], self = 999) =>
  planSweep(procs, NOW, self).kills.map((kill) => kill.pids);

describe("planSweep", () => {
  it("ends a runner whose launcher the task's time limit ended, with what it started, and keeps the launched one", () => {
    const procs = [
      proc(10, 1, "svchost.exe", 600),
      // the old pass: wscript is gone, cmd and bun ran on, a hung ffmpeg under it
      proc(21, 20, "cmd.exe", 70, SHELL),
      proc(22, 21, "bun.exe", 70, DAEMON),
      proc(23, 22, "node.exe", 60, "node fetch.mjs"),
      // the new pass, still under its launcher
      proc(30, 10, "wscript.exe", 5, "wscript.exe hidden-run.vbs app"),
      proc(31, 30, "cmd.exe", 5, SHELL),
      proc(32, 31, "bun.exe", 5, DAEMON),
    ];
    expect(planSweep(procs, NOW, 999).kills.map(({ pids, kind }) => ({ pids, kind }))).toEqual([
      { pids: [22, 23], kind: "scheduled pass" },
    ]);
  });

  it("keeps a runner whose task ended while a colleague's answer is under way, up to the ceiling (ruling H150)", () => {
    const answering = (minutesAgo: number) => [
      proc(21, 20, "cmd.exe", minutesAgo, SHELL),
      proc(22, 21, "bun.exe", minutesAgo, DAEMON),
      proc(23, 22, "claude.exe", minutesAgo - 1, COLLEAGUE),
    ];
    expect(planSweep(answering(55), NOW, 999)).toEqual({ kills: [], working: [22] });
    expect(ended(answering(RUN_CEILING_MS / 60_000 + 5))).toEqual([[22, 23]]);
  });

  it("never ends a daemon run by hand from a terminal's cmd, nor Matter's live supervisor", () => {
    const procs = [
      proc(40, 4, "cmd.exe", 90, "cmd.exe"),
      proc(41, 40, "bun.exe", 90, DAEMON),
      proc(
        42,
        4,
        "cmd.exe",
        600,
        SHELL.replace("scripts\\workforce\\daemon.ts", "scripts\\matter\\live.ts"),
      ),
      proc(43, 42, "bun.exe", 600, "bun scripts\\matter\\live.ts"),
      proc(44, 43, "claude.exe", 30, LIVE_CLI),
    ];
    expect(ended(procs)).toEqual([]);
  });

  it("never ends the sweep itself", () => {
    const procs = [
      proc(21, 20, "cmd.exe", 3, SHELL.replace("daemon.ts", "sweep.ts")),
      proc(22, 21, "bun.exe", 3, "bun scripts\\workforce\\sweep.ts"),
    ];
    expect(ended(procs, 22)).toEqual([]);
    expect(ended(procs, 999)).toEqual([[22]]);
  });

  it("keeps one studio pass, the one doing work, ends the rest and any past its cap", () => {
    const procs = [
      proc(50, 4, "bun.exe", 30, PASS),
      proc(51, 4, "bun.exe", 20, PASS),
      proc(
        52,
        51,
        "claude.exe",
        19,
        "claude -p --mcp-config C:\\Users\\DELL\\.mop-workforce\\studio-no-mcp.json",
      ),
      proc(53, 4, "bun.exe", 10, PASS),
    ];
    expect(ended(procs)).toEqual([[50], [53]]);
    const idle = [proc(54, 4, "bun.exe", 30, PASS), proc(55, 4, "bun.exe", 10, PASS)];
    expect(ended(idle)).toEqual([[55]]);
    const old = [
      proc(56, 4, "bun.exe", PASS_CAP_MS / 60_000 + 1, PASS),
      proc(57, 4, "bun.exe", 5, PASS),
    ];
    const kills = planSweep(old, NOW, 999).kills;
    expect(kills.map((kill) => kill.pids)).toEqual([[56]]);
    expect(kills[0]?.reason).toContain("past");
  });

  it("leaves a studio pass a runner started out of the runner's tree", () => {
    const procs = [
      proc(21, 20, "cmd.exe", 70, SHELL),
      proc(22, 21, "bun.exe", 70, DAEMON),
      proc(24, 22, "bun.exe", 60, PASS),
      proc(
        25,
        24,
        "ffmpeg.exe",
        2,
        "ffmpeg -i C:\\Users\\DELL\\.mop-workforce\\studio\\a\\out\\reel.mp4",
      ),
    ];
    expect(ended(procs)).toEqual([[22]]);
  });

  it("gives reel.ts's STALE_MS the first word on a pass", () => {
    expect(PASS_CAP_MS).toBeGreaterThan(STALE_MS);
  });

  it("ends orphans of the workforce and nothing else", () => {
    const procs = [
      proc(60, 1234, "claude.exe", 40, COLLEAGUE),
      proc(61, 1239, "claude.exe", 40, LIVE_CLI),
      // the desktop app, a person's own terminal session and a builder Matter started from his shell
      proc(
        62,
        4321,
        "claude.exe",
        400,
        '"C:\\Program Files\\WindowsApps\\Claude_3\\app\\Claude.exe" --startup',
      ),
      proc(63, 5555, "claude.exe", 40, "claude --resume abc"),
      proc(64, 5556, "claude.exe", 40, BUILDER),
      proc(
        65,
        1235,
        "ffmpeg.exe",
        2,
        "ffmpeg -i C:\\Users\\DELL\\.mop-workforce\\studio\\a\\shots\\01.png",
      ),
      proc(66, 1236, "ffmpeg.exe", 2, "ffmpeg -i D:\\holiday.mov out.mp4"),
      proc(67, 1238, "bun.exe", 9, "bun E:\\mop-build\\live\\launch\\engine\\render-reel.mjs"),
      proc(68, 1240, "node.exe", 9, "node D:\\other\\launch\\engine\\serve.mjs"),
      proc(69, 1241, "chrome.exe", 9, "chrome.exe --headless=new --remote-debugging-pipe"),
    ];
    expect(planSweep(procs, NOW, 999).kills.map((kill) => [kill.pids[0], kill.kind])).toEqual([
      [60, "CLI run"],
      [61, "CLI run"],
      [65, "ffmpeg"],
      [67, "render"],
    ]);
  });

  it("reads a parent started after its child as a reused id, so the child is an orphan", () => {
    const procs = [
      proc(70, 71, "ffmpeg.exe", 30, "ffmpeg C:\\Users\\DELL\\.mop-workforce\\studio\\x.mp4"),
      proc(71, 1, "notepad.exe", 5),
    ];
    expect(ended(procs)).toEqual([[70]]);
  });

  it("ends an ffmpeg under a pass past its cap, and leaves a young one and one run by hand", () => {
    const procs = [
      proc(80, 4, "bun.exe", 100, PASS),
      proc(81, 80, "ffmpeg.exe", FFMPEG_CAP_MS / 60_000 + 5),
      proc(82, 80, "ffmpeg.exe", 3),
      proc(83, 4, "bash.exe", 300),
      proc(84, 83, "ffmpeg.exe", FFMPEG_CAP_MS / 60_000 + 5),
    ];
    expect(ended(procs)).toEqual([[81]]);
  });

  it("names the runner by the claim name daemon.ts uses", () => {
    expect(runnerWorker(4242)).toBe(`${hostname()}:4242`);
  });
});

describe("the studio folder", () => {
  const studioWith = (pieces: [string, Record<string, unknown>][]) => {
    const studio = mkdtempSync(join(tmpdir(), "sweep-studio-"));
    for (const [name, brief] of pieces) {
      mkdirSync(join(studio, name));
      writeFileSync(join(studio, name, "brief.json"), JSON.stringify(brief));
    }
    return studio;
  };
  const at = (minutesAgo: number) => new Date(ago(minutesAgo)).toISOString();

  it("names queued pieces older than the wait, oldest first, and skips the rest", () => {
    const studio = studioWith([
      ["young", { state: "queued", at: at(5) }],
      ["old", { state: "queued", at: at(90) }],
      ["older", { state: "queued", at: at(120) }],
      ["made", { state: "done", at: at(300) }],
    ]);
    mkdirSync(join(studio, "broken"));
    writeFileSync(join(studio, "broken", "brief.json"), "{");
    expect(waitingPieces(studio, NOW)).toEqual(["older (120 min)", "old (90 min)"]);
    expect(WAIT_MS).toBe(30 * 60_000);
  });

  it("puts a piece nobody is making back in the queue, fails it the second time, and leaves a fresh one", () => {
    const studio = studioWith([
      ["lost", { state: "working", at: at(60), started: at(40), id: "keep-me" }],
      [
        "lost-again",
        {
          state: "working",
          at: at(90),
          started: at(30),
          reason: "returned to the queue by the sweep: no pass was making it",
        },
      ],
      ["fresh", { state: "working", at: at(3), started: at(2) }],
    ]);
    expect(returnOrphanedPieces(studio, NOW)).toEqual(["lost (queued)", "lost-again (failed)"]);
    const lost: unknown = JSON.parse(readFileSync(join(studio, "lost", "brief.json"), "utf8"));
    expect(lost).toEqual({
      state: "queued",
      at: at(60),
      id: "keep-me",
      reason: "returned to the queue by the sweep: no pass was making it",
    });
    const fresh: unknown = JSON.parse(readFileSync(join(studio, "fresh", "brief.json"), "utf8"));
    expect(fresh).toMatchObject({ state: "working" });
  });
});

describe("report", () => {
  const quiet = {
    ended: [],
    failedRuns: 0,
    pieces: [],
    waitingRuns: { count: 0, oldestMs: 0 },
    waitingPieces: [],
    passAlive: false,
    runnerAlive: true,
  };
  it("says nothing when nothing was stuck", () => {
    expect(report(quiet)).toBeNull();
  });
  it("names each ended process, the failed runs and what waits, and asks for the cause", () => {
    const text = report({
      ...quiet,
      ended: [{ pids: [7, 8], kind: "studio pass", reason: "a second studio pass", ok: true }],
      failedRuns: 1,
      waitingRuns: { count: 2, oldestMs: 45 * 60_000 },
      waitingPieces: ["2026-10-27-post (40 min)"],
    });
    expect(text).toContain("ended 1 stuck process tree(s)");
    expect(text).toContain("studio pass 7: a second studio pass");
    expect(text).toContain("1 run(s) the ended runner held are marked failed");
    expect(text).toContain(
      "2 run(s) queued over 30 min, the oldest 45 min; the runner is passing.",
    );
    expect(text).toContain("2026-10-27-post (40 min); a studio pass is not running.");
    expect(text).toContain("Find why it hung and fix the cause.");
  });
  it("keys the same stall the same way as its minutes grow, so it is said once", () => {
    const waiting = (minutes: number) =>
      report({ ...quiet, waitingRuns: { count: 2, oldestMs: minutes * 60_000 } }) ?? "";
    expect(reportKey(waiting(45))).toBe(reportKey(waiting(50)));
    expect(reportKey(waiting(45))).not.toBe(
      reportKey(report({ ...quiet, waitingRuns: { count: 3, oldestMs: 45 * 60_000 } }) ?? ""),
    );
  });
});
