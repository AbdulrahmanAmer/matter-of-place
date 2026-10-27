import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { STALE_MS } from "../../scripts/workforce/reel.ts";
import {
  FFMPEG_CAP_MS,
  PASS_CAP_MS,
  planSweep,
  report,
  waitingPieces,
  WAIT_MS,
  type Proc,
} from "../../scripts/workforce/sweep.ts";

// Operator, 2026-10-27: "make sure that they are able to check if things are stuck and clean behind them". The sweep
// ends what nobody waits for, from one process listing; these cases are the stacks the laptop actually had.
const NOW = Date.parse("2026-10-27T15:00:00Z");
const ago = (minutes: number) => NOW - minutes * 60_000;
const proc = (pid: number, parent: number, name: string, startedMinAgo: number, command = ""): Proc => ({
  pid,
  parent,
  name,
  started: ago(startedMinAgo),
  command,
});

const DAEMON = 'bun  scripts\\workforce\\daemon.ts';
const PASS = 'bun "E:\\mop-build\\live\\app\\scripts\\workforce\\reel.ts" --pass';
const COLLEAGUE =
  'claude -p --model sonnet --mcp-config C:\\Users\\DELL\\.mop-workforce\\no-mcp.json --permission-mode dontAsk';

describe("planSweep", () => {
  it("ends a scheduled pass whose launcher the task's time limit ended, and keeps the one still launched", () => {
    const procs = [
      proc(10, 1, "svchost.exe", 600),
      // the old pass: wscript is gone, cmd and bun ran on
      proc(21, 20, "cmd.exe", 70, "cmd.exe /c cd /d app && bun scripts\\workforce\\daemon.ts"),
      proc(22, 21, "bun.exe", 70, DAEMON),
      // the new pass, still under its launcher
      proc(30, 10, "wscript.exe", 5, "wscript.exe hidden-run.vbs app"),
      proc(31, 30, "cmd.exe", 5),
      proc(32, 31, "bun.exe", 5, DAEMON),
    ];
    expect(planSweep(procs, NOW, 999)).toEqual([
      expect.objectContaining({ pid: 22, kind: "scheduled pass" }),
    ]);
  });

  it("never ends the sweep itself or its own launcher chain", () => {
    const procs = [
      proc(21, 20, "cmd.exe", 3),
      proc(22, 21, "bun.exe", 3, "bun scripts\\workforce\\daemon.ts"),
    ];
    expect(planSweep(procs, NOW, 22)).toEqual([]);
  });

  it("keeps one studio pass, ends the second, and ends any past its cap", () => {
    const procs = [
      proc(40, 4, "bun.exe", 30, PASS),
      proc(41, 4, "bun.exe", 20, PASS),
      proc(42, 4, "bun.exe", 10, PASS),
    ];
    expect(planSweep(procs, NOW, 999).map((kill) => kill.pid)).toEqual([41, 42]);
    const old = [proc(43, 4, "bun.exe", PASS_CAP_MS / 60_000 + 1, PASS), proc(44, 4, "bun.exe", 5, PASS)];
    expect(planSweep(old, NOW, 999)).toEqual([
      expect.objectContaining({ pid: 43, reason: expect.stringContaining("past") }),
    ]);
  });

  it("gives the pass's own watchdog (reel.ts STALE_MS) the first word", () => {
    expect(PASS_CAP_MS).toBeGreaterThan(STALE_MS);
  });

  it("ends orphans of ours and nothing else", () => {
    const procs = [
      proc(50, 1234, "claude.exe", 40, COLLEAGUE),
      // the desktop app is claude.exe too, and its parent may be gone: never ended
      proc(51, 4321, "claude.exe", 400, '"C:\\Program Files\\WindowsApps\\Claude_3\\app\\Claude.exe" --startup'),
      // a person's own claude in a terminal names no workforce file
      proc(52, 5555, "claude.exe", 40, "claude --resume abc"),
      proc(53, 1235, "ffmpeg.exe", 2, "ffmpeg -i in.mp4 out.jpg"),
      proc(54, 1236, "chrome.exe", 9, "chrome.exe --headless=new --remote-debugging-pipe"),
      proc(55, 54, "chrome.exe", 9, "chrome.exe --type=renderer --headless=new"),
      proc(56, 1237, "chrome.exe", 300, "chrome.exe --profile-directory=Default"),
      proc(57, 1238, "bun.exe", 9, "bun launch/engine/render-reel.mjs"),
    ];
    expect(planSweep(procs, NOW, 999).map((kill) => [kill.pid, kill.kind])).toEqual([
      [50, "Claude run"],
      [53, "ffmpeg"],
      [54, "headless browser"],
      [57, "render"],
    ]);
  });

  it("reads a parent started after its child as a reused id, so the child is an orphan", () => {
    const procs = [proc(60, 61, "ffmpeg.exe", 30), proc(61, 1, "notepad.exe", 5)];
    expect(planSweep(procs, NOW, 999).map((kill) => kill.pid)).toEqual([60]);
  });

  it("ends an ffmpeg past its cap even with its parent alive, and leaves a young one", () => {
    const procs = [
      proc(70, 1, "bun.exe", 200),
      proc(71, 70, "ffmpeg.exe", FFMPEG_CAP_MS / 60_000 + 5),
      proc(72, 70, "ffmpeg.exe", 3),
    ];
    expect(planSweep(procs, NOW, 999).map((kill) => kill.pid)).toEqual([71]);
  });

  it("leaves a working colleague's run alone however long it takes (no clock on their work, 2026-10-15)", () => {
    const procs = [
      proc(80, 1, "wscript.exe", 49),
      proc(81, 80, "cmd.exe", 49),
      proc(82, 81, "bun.exe", 49, DAEMON),
      proc(83, 82, "claude.exe", 48, COLLEAGUE),
    ];
    expect(planSweep(procs, NOW, 999)).toEqual([]);
  });
});

describe("waitingPieces", () => {
  it("names queued pieces older than the wait, oldest first, and skips the rest", () => {
    const studio = mkdtempSync(join(tmpdir(), "sweep-studio-"));
    const piece = (name: string, state: string, minutesAgo: number) => {
      mkdirSync(join(studio, name));
      writeFileSync(
        join(studio, name, "brief.json"),
        JSON.stringify({ state, at: new Date(ago(minutesAgo)).toISOString() }),
      );
    };
    piece("young", "queued", 5);
    piece("old", "queued", 90);
    piece("older", "queued", 120);
    piece("made", "done", 300);
    mkdirSync(join(studio, "broken"));
    writeFileSync(join(studio, "broken", "brief.json"), "{");
    expect(waitingPieces(studio, NOW)).toEqual(["older (120 min)", "old (90 min)"]);
    expect(WAIT_MS).toBe(30 * 60_000);
  });
});

describe("report", () => {
  const quiet = {
    ended: [],
    failedRuns: 0,
    waitingRuns: { count: 0, oldestMs: 0 },
    waitingPieces: [],
    passAlive: false,
    runnerAlive: true,
  };
  it("says nothing when nothing was stuck", () => {
    expect(report(quiet)).toBeNull();
  });
  it("names each ended process, the failed runs and what waits", () => {
    const text = report({
      ...quiet,
      ended: [{ pid: 7, kind: "studio pass", reason: "a second studio pass", ok: true }],
      failedRuns: 1,
      waitingRuns: { count: 2, oldestMs: 45 * 60_000 },
      waitingPieces: ["2026-10-27-post (40 min)"],
    });
    expect(text).toContain("ended 1 stuck process(es)");
    expect(text).toContain("studio pass 7: a second studio pass");
    expect(text).toContain("1 run(s) the ended runner held are marked failed");
    expect(text).toContain("2 run(s) queued over 30 min, the oldest 45 min; the runner is running.");
    expect(text).toContain("2026-10-27-post (40 min); a studio pass is not running.");
  });
});
