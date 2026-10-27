import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Db } from "../../src/server/lib/db";
import { STALE_MS } from "../../scripts/workforce/reel.ts";
import {
  FFMPEG_CAP_MS,
  PASS_CAP_MS,
  planSweep,
  report,
  reportKey,
  returnOrphanedPieces,
  RUN_CEILING_MS,
  runnerPass,
  runnerWorker,
  settleRuns,
  waitingPieces,
  WAIT_MS,
  type Claim,
  type Findings,
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
): Proc => ({ pid, parent, name, started: ago(startedMinAgo), command });

const SHELL =
  'cmd.exe /c cd /d "E:\\mop-build\\live\\app" && bun scripts\\workforce\\daemon.ts >> "C:\\Users\\DELL\\.mop-workforce\\daemon.log" 2>&1';
const DAEMON = "bun  scripts\\workforce\\daemon.ts";
const PASS = 'bun "E:\\mop-build\\live\\app\\scripts\\workforce\\reel.ts" --pass';
const COLLEAGUE =
  "claude -p --model sonnet --mcp-config C:\\Users\\DELL\\.mop-workforce\\no-mcp.json --permission-mode dontAsk";
const STUDIO_CLI =
  "claude -p --mcp-config C:\\Users\\DELL\\.mop-workforce\\studio-no-mcp.json --restricted";
const LIVE_CLI =
  "claude -p --settings E:\\mop-build\\live\\app\\scripts\\matter\\settings-full.json --input-format stream-json --output-format stream-json";
const BUILDER =
  "claude -p --settings E:/mop-build/live/app/scripts/matter/settings-full.json --model opus";
const STUDIO_FFMPEG = "ffmpeg -i C:\\Users\\DELL\\.mop-workforce\\studio\\a\\shots\\01.png";
// a lease as Postgres writes it, to the microsecond (a JavaScript date keeps milliseconds only)
const claim = (minutesAgo: number): Claim => ({
  at: ago(minutesAgo),
  lease: new Date(ago(minutesAgo) + 3000_000).toISOString().replace("Z", "456+00:00"),
});
const ended = (procs: Proc[], self = 999, claims = new Map<number, Claim | null>()) =>
  planSweep(procs, NOW, self, claims).map((kill) => kill.pids);

describe("planSweep", () => {
  it("ends a runner whose task was stopped under it, with what it started, its runs back in the queue", () => {
    const procs = [
      proc(10, 1, "svchost.exe", 600),
      // the old pass: wscript is gone, cmd and bun ran on, a node child under it
      proc(21, 20, "cmd.exe", 70, SHELL),
      proc(22, 21, "bun.exe", 70, DAEMON),
      proc(23, 22, "node.exe", 60, "node fetch.mjs"),
      // the new pass, still under its launcher
      proc(30, 10, "wscript.exe", 5, "wscript.exe hidden-run.vbs app"),
      proc(31, 30, "cmd.exe", 5, SHELL),
      proc(32, 31, "bun.exe", 5, DAEMON),
    ];
    expect(
      planSweep(procs, NOW, 999).map(({ pids, kind, runs }) => ({ pids, kind, runs })),
    ).toEqual([{ pids: [22, 23], kind: "scheduled pass", runs: "requeue" }]);
  });

  it("lets a launched runner's run answer with no clock up to its ceiling, then ends it and fails its runs (H150)", () => {
    const launched = (minutesAgo: number) => [
      proc(20, 1, "wscript.exe", minutesAgo, "wscript.exe hidden-run.vbs app"),
      proc(21, 20, "cmd.exe", minutesAgo, SHELL),
      proc(22, 21, "bun.exe", minutesAgo, DAEMON),
      proc(23, 22, "claude.exe", 20, COLLEAGUE),
    ];
    const old = RUN_CEILING_MS / 60_000 + 30;
    // a young pass is never judged, even one holding no run
    expect(ended(launched(55))).toEqual([]);
    expect(ended(launched(55), 999, new Map([[22, null]]))).toEqual([]);
    // an old pass whose current run was claimed 20 minutes ago, or whose runs cannot be read, keeps working
    expect(ended(launched(old), 999, new Map([[22, claim(20)]]))).toEqual([]);
    expect(ended(launched(old))).toEqual([]);
    // its run has answered past the ceiling: it has hung, and the run read before the kill is the one failed
    const late = planSweep(launched(old), NOW, 999, new Map([[22, claim(old - 1)]]));
    expect(late.map(({ pids, runs, lease }) => ({ pids, runs, lease }))).toEqual([
      { pids: [22, 23], runs: "fail", lease: claim(old - 1).lease },
    ]);
    // holding no run when read, it is ended with no run to fail
    const idle = planSweep(launched(old), NOW, 999, new Map([[22, null]]));
    expect(idle.map(({ pids, runs }) => ({ pids, runs }))).toEqual([
      { pids: [22, 23], runs: undefined },
    ]);
  });

  it("never ends a daemon run by hand from a terminal's cmd, nor Matter's live supervisor", () => {
    const procs = [
      proc(40, 4, "cmd.exe", 900, "cmd.exe"),
      proc(41, 40, "bun.exe", 900, DAEMON),
      proc(
        42,
        4,
        "cmd.exe",
        900,
        SHELL.replace("scripts\\workforce\\daemon.ts", "scripts\\matter\\live.ts"),
      ),
      proc(43, 42, "bun.exe", 900, "bun scripts\\matter\\live.ts"),
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

  it("keeps one studio pass, the one making a piece, ends the rest and any past its cap", () => {
    const procs = [
      proc(50, 4, "bun.exe", 30, PASS),
      proc(58, 50, "ffmpeg.exe", 29, STUDIO_FFMPEG),
      proc(51, 4, "bun.exe", 20, PASS),
      proc(52, 51, "claude.exe", 19, STUDIO_CLI),
      proc(53, 4, "bun.exe", 10, PASS),
    ];
    expect(ended(procs)).toEqual([[50, 58], [53]]);
    // with nothing under any pass, the old one is the one that hung: the newest stays
    const idle = [proc(54, 4, "bun.exe", 30, PASS), proc(55, 4, "bun.exe", 10, PASS)];
    expect(ended(idle)).toEqual([[54]]);
    // a piece marked `working` 20 minutes ago was marked by a pass started before it, between its child processes
    // the pass holding the studio's lock is kept, and a lock whose start is not that process's is someone else's id
    const locked = (started: number) => planSweep(idle, NOW, 999, new Map(), { pid: 54, started });
    expect(locked(ago(30)).map((kill) => kill.pids)).toEqual([[55]]);
    expect(locked(ago(5)).map((kill) => kill.pids)).toEqual([[54]]);
    const old = [
      proc(56, 4, "bun.exe", PASS_CAP_MS / 60_000 + 1, PASS),
      proc(57, 4, "bun.exe", 5, PASS),
    ];
    const kills = planSweep(old, NOW, 999);
    expect(kills.map((kill) => kill.pids)).toEqual([[56]]);
    expect(kills[0]?.reason).toContain("past");
  });

  it("leaves a studio pass a runner started out of the runner's tree", () => {
    const procs = [
      proc(21, 20, "cmd.exe", 70, SHELL),
      proc(22, 21, "bun.exe", 70, DAEMON),
      proc(24, 22, "bun.exe", 60, PASS),
      proc(25, 24, "ffmpeg.exe", 2, STUDIO_FFMPEG),
    ];
    expect(ended(procs)).toEqual([[22]]);
  });

  it("gives reel.ts's STALE_MS the first word on a pass", () => {
    expect(PASS_CAP_MS).toBeGreaterThan(STALE_MS);
    expect(RUN_CEILING_MS).toBe(PASS_CAP_MS);
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
      proc(65, 1235, "ffmpeg.exe", 15, STUDIO_FFMPEG),
      // a studio ffmpeg just started may belong to a pass started after the listing
      proc(66, 1236, "ffmpeg.exe", 2, STUDIO_FFMPEG),
      proc(67, 1237, "ffmpeg.exe", 15, "ffmpeg -i D:\\holiday.mov out.mp4"),
      proc(68, 1238, "bun.exe", 15, "bun E:\\mop-build\\live\\launch\\engine\\render-reel.mjs"),
      // an agent's worktree renders on its own
      proc(
        69,
        1240,
        "bun.exe",
        15,
        "bun E:\\mop-build\\seo-pages\\launch\\engine\\render-reel.mjs",
      ),
      proc(70, 1241, "chrome.exe", 15, "chrome.exe --headless=new --remote-debugging-pipe"),
    ];
    expect(planSweep(procs, NOW, 999).map((kill) => [kill.pids[0], kill.kind])).toEqual([
      [60, "CLI run"],
      [61, "CLI run"],
      [65, "ffmpeg"],
      [68, "render"],
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

describe("runnerPass", () => {
  it("names the runner's launched pass and its age, and none when no pass is alive", () => {
    const procs = [
      proc(20, 1, "wscript.exe", 40, "wscript.exe hidden-run.vbs app"),
      proc(21, 20, "cmd.exe", 40, SHELL),
      proc(22, 21, "bun.exe", 40, DAEMON),
      proc(31, 30, "cmd.exe", 90, SHELL),
      proc(32, 31, "bun.exe", 90, DAEMON),
    ];
    expect(runnerPass(procs, NOW)).toEqual({ pid: 22, ageMs: 40 * 60_000 });
    expect(runnerPass(procs.slice(3), NOW)).toBeNull();
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
  const RETURNED = "returned to the queue by the sweep: no pass was making it";

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
      ["lost-again", { state: "working", at: at(90), started: at(30), reason: RETURNED }],
      ["fresh", { state: "working", at: at(3), started: at(2) }],
    ]);
    expect(returnOrphanedPieces(studio, NOW)).toEqual(["lost (queued)", "lost-again (failed)"]);
    const lost: unknown = JSON.parse(readFileSync(join(studio, "lost", "brief.json"), "utf8"));
    expect(lost).toEqual({ state: "queued", at: at(60), id: "keep-me", reason: RETURNED });
    const fresh: unknown = JSON.parse(readFileSync(join(studio, "fresh", "brief.json"), "utf8"));
    expect(fresh).toMatchObject({ state: "working" });
  });
});

describe("settleRuns", () => {
  type Run = {
    id: string;
    state: string;
    worker: string | null;
    lease_until: string | null;
    message_id: string | null;
    error?: string;
  };
  const lines: Record<string, { thread: string; author_kind: string }> = {
    "m-person": { thread: "matter", author_kind: "human" },
    "m-colleague": { thread: "social", author_kind: "agent" },
  };
  // agent_runs updates and agent_messages reads and inserts: what settleRuns touches, nothing else
  function fakeDb(runs: Run[], told: { thread: string; body: string }[]): Db {
    const from = (table: string) => {
      const tests: ((row: Record<string, unknown>) => boolean)[] = [];
      let change: Partial<Run> = {};
      const chain = {
        update(next: Partial<Run>) {
          change = next;
          return chain;
        },
        eq(column: string, value: string) {
          tests.push((row) => row[column] === value);
          return chain;
        },
        lte(column: string, value: string) {
          tests.push((row) => {
            const cell = row[column];
            return typeof cell === "string" && cell <= value;
          });
          return chain;
        },
        select() {
          if (table === "agent_messages") return chain;
          const hit = runs.filter((row) => tests.every((test) => test(row)));
          for (const row of hit) Object.assign(row, change);
          return Promise.resolve({
            data: hit.map(({ message_id }) => ({ message_id })),
            error: null,
          });
        },
        single() {
          const id = Object.keys(lines).find((key) => tests.every((test) => test({ id: key })));
          return Promise.resolve({ data: id === undefined ? null : lines[id], error: null });
        },
        insert(row: { thread: string; body: string }) {
          told.push({ thread: row.thread, body: row.body });
          return Promise.resolve({ error: null });
        },
      };
      return chain;
    };
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- a client of the two tables settleRuns touches; nothing else is reached
    return { from } as unknown as Db;
  }

  it("requeues a stopped runner's runs, fails a hung one's and tells its person, and leaves a newer claim", async () => {
    const killedAt = NOW;
    const lease = (minutesFromKill: number) =>
      new Date(killedAt + minutesFromKill * 60_000).toISOString();
    const runs: Run[] = [
      // claimed after the kill by a runner that got the stopped one's id: not the stopped runner's run
      {
        id: "h",
        state: "running",
        worker: runnerWorker(11),
        lease_until: lease(55),
        message_id: null,
      },
      {
        id: "a",
        state: "running",
        worker: runnerWorker(11),
        lease_until: lease(20),
        message_id: "m-person",
      },
      {
        id: "b",
        state: "running",
        worker: runnerWorker(12),
        lease_until: lease(40),
        message_id: "m-person",
      },
      {
        id: "c",
        state: "running",
        worker: runnerWorker(12),
        lease_until: lease(45),
        message_id: "m-colleague",
      },
      // claimed after the kill by a runner that got the same id: left alone
      {
        id: "d",
        state: "running",
        worker: runnerWorker(12),
        lease_until: lease(55),
        message_id: null,
      },
      // claimed by the hung pass after the sweep read its claim, before the kill: not the run that hung
      {
        id: "g",
        state: "running",
        worker: runnerWorker(12),
        lease_until: lease(48),
        message_id: "m-person",
      },
      {
        id: "e",
        state: "done",
        worker: runnerWorker(12),
        lease_until: lease(10),
        message_id: null,
      },
      // a kill that did not take holds its runs
      {
        id: "f",
        state: "running",
        worker: runnerWorker(13),
        lease_until: lease(10),
        message_id: null,
      },
    ];
    const told: { thread: string; body: string }[] = [];
    const settled = await settleRuns(
      fakeDb(runs, told),
      [
        { pids: [11], kind: "scheduled pass", reason: "stopped", runs: "requeue", ok: true },
        // the lease read before the kill: a run the pass claimed after that read is never failed with it
        {
          pids: [12],
          kind: "scheduled pass",
          reason: "hung",
          runs: "fail",
          lease: lease(45),
          ok: true,
        },
        { pids: [13], kind: "scheduled pass", reason: "hung", runs: "fail", ok: false },
      ],
      killedAt,
    );
    expect(settled).toEqual({ requeued: 1, failed: 2 });
    expect(runs.map((run) => [run.id, run.state])).toEqual([
      ["h", "running"],
      ["a", "queued"],
      ["b", "failed"],
      ["c", "failed"],
      ["d", "running"],
      ["g", "running"],
      ["e", "done"],
      ["f", "running"],
    ]);
    expect(told.map((line) => line.thread)).toEqual(["matter"]);
    expect(told[0]?.body).toContain("send it again");
  });
});

describe("report", () => {
  const quiet: Findings = {
    ended: [],
    settled: { requeued: 0, failed: 0 },
    pieces: [],
    waitingRuns: { count: 0, oldestMs: 0, oldestId: "" },
    waitingPieces: [],
    passAlive: false,
    runner: null,
  };
  it("says nothing when nothing was stuck", () => {
    expect(report(quiet)).toBeNull();
  });
  it("names each ended process, what became of the runs and what waits, and asks for the cause", () => {
    const text = report({
      ...quiet,
      ended: [{ pids: [7, 8], kind: "studio pass", reason: "a second studio pass", ok: true }],
      settled: { requeued: 2, failed: 1 },
      waitingRuns: { count: 2, oldestMs: 45 * 60_000, oldestId: "run-1" },
      waitingPieces: ["2026-10-27-post (40 min)"],
      runner: { pid: 4242, ageMs: 52 * 60_000 },
    });
    expect(text).toContain("ended 1 stuck process tree(s)");
    expect(text).toContain("studio pass 7: a second studio pass");
    expect(text).toContain("2 run(s) the stopped runner held are back in the queue.");
    expect(text).toContain("1 run(s) the hung runner held are marked failed");
    expect(text).toContain(
      "2 run(s) a colleague can take queued over 30 min, the oldest 45 min (run-1); the runner pass 4242 has been running 52 min.",
    );
    expect(text).toContain("2026-10-27-post (40 min); a studio pass is not running.");
    expect(text).toContain("Find why it hung and fix the cause.");
    expect(report({ ...quiet, waitingRuns: { count: 1, oldestMs: 0, oldestId: "r" } })).toContain(
      "no runner pass is alive",
    );
  });
  it("keys the same stall the same way as its numbers grow and passes come and go, so it is said once", () => {
    const stall = (count: number, minutes: number, pid: number): Findings => ({
      ...quiet,
      ended: [{ pids: [pid], kind: "studio pass", reason: "second", ok: true }],
      waitingRuns: { count, oldestMs: minutes * 60_000, oldestId: "run-1" },
      waitingPieces: [`a-piece (${String(minutes)} min)`],
      runner: { pid: 4242, ageMs: minutes * 60_000 },
    });
    expect(reportKey(stall(2, 45, 7))).toBe(reportKey(stall(3, 75, 9)));
    // a backlog draining while the runner passes every minute (a new process each time) is the same stall
    const cycling = (oldestId: string, pid: number): Findings => ({
      ...stall(2, 45, 7),
      waitingRuns: { count: 2, oldestMs: 45 * 60_000, oldestId },
      runner: { pid, ageMs: 60_000 },
    });
    expect(reportKey(cycling("run-1", 5151))).toBe(reportKey(cycling("run-2", 6161)));
    // a runner pass held past the wait is another stall than one that cycles, and than none alive
    expect(reportKey(stall(2, 45, 7))).not.toBe(reportKey(cycling("run-1", 4242)));
    // and a sweep that finds the cycling runner between two passes sees the same stall
    expect(reportKey(cycling("run-1", 5151))).toBe(
      reportKey({ ...cycling("run-1", 5151), runner: null }),
    );
  });
});
