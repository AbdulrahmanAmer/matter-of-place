// The laptop's cleaner (operator, 2026-10-27: "make sure that they are able to check if things are stuck and clean
// behind them and things shouldn't sit in queue"). The scheduled task "MOP Sweep" (install.ps1) runs it every five
// minutes, apart from the runner, so a runner that hangs cannot stop it. Each sweep:
//   1. reads every process once and ends, with all it started, the workforce processes nobody is waiting for:
//      - a scheduled pass whose task was ended by its time limit: Windows stops the hidden launcher (wscript.exe) and
//        never its children, so the pass ran on and a new one started beside it every minute (2026-10-27);
//      - a second studio pass (`reel.ts --pass`), and any pass older than PASS_CAP_MS (262 were alive once);
//      - a Claude run, ffmpeg, headless browser or render script whose starting process is gone;
//      - an ffmpeg older than FFMPEG_CAP_MS;
//   2. fails the runs a killed runner held, so no other runner claims them again into the same wall;
//   3. names what waits too long (a run queued, a studio piece queued) with what is in the way;
//   4. says what it did in Matter's thread, once per sweep, and keeps its lines in ~/.mop-workforce/sweep.log.
// A colleague's run that is working has no clock here (operator, 2026-10-15); only its runner's scheduled limit ends it.
//   bun scripts/workforce/sweep.ts        one sweep
//   bun scripts/workforce/sweep.ts --dry  what it would end, ending nothing
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { join } from "node:path";
import type { Db } from "../../src/server/lib/db.ts";

const HOME = join(homedir(), ".mop-workforce");

/** One process as Windows lists it; `started` in milliseconds. */
export type Proc = { pid: number; parent: number; name: string; started: number; command: string };

/** A process to end with everything it started, and why. */
type Kill = { pid: number; kind: string; reason: string };

/** The scripts a scheduled task starts through hidden-run.vbs (`cmd.exe /c ... bun <script>`). */
const SCHEDULED =
  /scripts[\\/](?:workforce[\\/](?:daemon|meeting|review)\.ts|matter[\\/]live\.ts|captions-runner\.ts|audit-routine\.ts|usage-push\.ts)/;

/** The studio's own process, started detached by the runner (W7 item 19). */
const STUDIO_PASS = /reel\.ts"?\s+--pass\b/;

/** Render steps a studio pass or a colleague starts. */
const RENDER = /render-reel\.mjs|still\.mjs|brand-post\.ts|launch[\\/]engine[\\/]/;

/**
 * A pass longer than this is ended: reel.ts marks a piece `working` longer than STALE_MS (3 h) as abandoned and its
 * own watchdog ends there; the quarter hour is room for that watchdog to act first.
 */
export const PASS_CAP_MS = 3 * 60 * 60_000 + 15 * 60_000;

/** The longest render P-2100 measured was 836 s with the laptop loaded; an hour is a hung encoder. */
export const FFMPEG_CAP_MS = 60 * 60_000;

/** A run or a studio piece queued longer than this is named, with what is in its way. */
export const WAIT_MS = 30 * 60_000;

const isBun = (proc: Proc) => /^(bun|node)(\.exe)?$/i.test(proc.name);
const isShell = (proc: Proc) => /^cmd\.exe$/i.test(proc.name);
const isLauncher = (proc: Proc) => /^wscript\.exe$/i.test(proc.name);
const isFfmpeg = (proc: Proc) => /^ff(mpeg|probe)(\.exe)?$/i.test(proc.name);

/**
 * A Claude CLI run of ours: the runner's and the studio's name their settings or MCP file under ~/.mop-workforce or
 * scripts/matter. The desktop app is claude.exe too and is never one (its path is under WindowsApps).
 */
const isOurClaude = (proc: Proc) =>
  /^claude(\.exe)?$/i.test(proc.name) &&
  !/WindowsApps/i.test(proc.command) &&
  /\.mop-workforce|scripts[\\/]matter[\\/]settings/i.test(proc.command);

/** A headless browser's main process (its helpers carry `--type=` and end with it). */
const isHeadlessBrowser = (proc: Proc) =>
  /^(chrome|chromium|chrome-headless-shell|msedge)(\.exe)?$/i.test(proc.name) &&
  /--headless/.test(proc.command) &&
  !/--type=/.test(proc.command);

const minutes = (ms: number) => `${String(Math.round(ms / 60_000))} min`;

/**
 * What one sweep ends, from one listing of the processes. `self` is the sweep's own process and is never ended (its
 * launchers, cmd.exe and wscript.exe, match no rule). A parent started after its child is a reused process id, so that
 * child counts as orphaned.
 */
export function planSweep(procs: Proc[], now: number, self: number): Kill[] {
  const byPid = new Map(procs.map((proc) => [proc.pid, proc]));
  const parentOf = (proc: Proc): Proc | undefined => {
    const parent = byPid.get(proc.parent);
    return parent !== undefined && parent.started <= proc.started && parent.pid !== proc.pid
      ? parent
      : undefined;
  };
  const kills = new Map<number, Kill>();
  const end = (proc: Proc, kind: string, reason: string) => {
    if (proc.pid !== self && !kills.has(proc.pid))
      kills.set(proc.pid, { pid: proc.pid, kind, reason });
  };

  const passes: Proc[] = [];
  for (const proc of procs) {
    const parent = parentOf(proc);
    if (isBun(proc) && STUDIO_PASS.test(proc.command)) {
      passes.push(proc);
      continue;
    }
    if (isBun(proc) && SCHEDULED.test(proc.command)) {
      // hidden-run.vbs: wscript.exe waits on cmd.exe, which runs bun. With the launcher gone, the task has ended.
      const launcher = parent !== undefined && isShell(parent) ? parentOf(parent) : undefined;
      if (parent !== undefined && isShell(parent) && (launcher === undefined || !isLauncher(launcher)))
        end(
          proc,
          "scheduled pass",
          `its scheduled task ended it at the time limit, but it ran on for ${minutes(now - proc.started)}`,
        );
      continue;
    }
    if (parent === undefined) {
      if (isOurClaude(proc))
        end(proc, "Claude run", "the process that started it is gone, so nobody reads its answer");
      else if (isFfmpeg(proc)) end(proc, "ffmpeg", "the render that started it is gone");
      else if (isHeadlessBrowser(proc))
        end(proc, "headless browser", "the render that started it is gone");
      else if (isBun(proc) && RENDER.test(proc.command))
        end(proc, "render", "the pass that started it is gone");
      continue;
    }
    if (isFfmpeg(proc) && now - proc.started > FFMPEG_CAP_MS)
      end(proc, "ffmpeg", `running ${minutes(now - proc.started)}, past ${minutes(FFMPEG_CAP_MS)}`);
  }

  // One studio pass at a time: the oldest within its cap stays, every other one ends.
  let kept = false;
  for (const pass of passes.sort((a, b) => a.started - b.started)) {
    if (now - pass.started > PASS_CAP_MS)
      end(
        pass,
        "studio pass",
        `running ${minutes(now - pass.started)}, past ${minutes(PASS_CAP_MS)}`,
      );
    else if (kept) end(pass, "studio pass", "a second studio pass; the studio makes one at a time");
    else kept = true;
  }
  return [...kills.values()];
}

/** Every process, from one PowerShell call (times in UTC, so no locale reads them). */
function listProcesses(): Proc[] {
  const script =
    "Get-CimInstance Win32_Process | ForEach-Object { [pscustomobject]@{ pid = [int]$_.ProcessId; parent = [int]$_.ParentProcessId; " +
    "name = [string]$_.Name; started = $(if ($_.CreationDate) { $_.CreationDate.ToUniversalTime().ToString('o') } else { '' }); " +
    "command = [string]$_.CommandLine } } | ConvertTo-Json -Compress";
  const listed = spawnSync("powershell", ["-NoProfile", "-Command", script], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 60_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (listed.status !== 0) throw new Error("sweep: the process list could not be read");
  const rows = JSON.parse(listed.stdout) as
    | { pid: number; parent: number; name: string; started: string; command: string | null }[]
    | null;
  return (rows ?? []).map((row) => ({
    pid: row.pid,
    parent: row.parent,
    name: row.name,
    started: row.started === "" ? 0 : Date.parse(row.started),
    command: row.command ?? "",
  }));
}

/** Ends a process and every process it started. */
function endTree(pid: number): boolean {
  const ended = spawnSync("taskkill", ["/T", "/F", "/PID", String(pid)], {
    windowsHide: true,
    timeout: 30_000,
  });
  return ended.status === 0;
}

/** The runner's claim name for a process id (daemon.ts: `${hostname()}:${pid}`). */
const runnerWorker = (pid: number) => `${hostname()}:${String(pid)}`;

/** Studio pieces queued longer than WAIT_MS, oldest first, as "folder (N min)". */
export function waitingPieces(studio: string, now: number): string[] {
  if (!existsSync(studio)) return [];
  return readdirSync(studio, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      try {
        const brief = JSON.parse(readFileSync(join(studio, entry.name, "brief.json"), "utf8")) as {
          state?: string;
          at?: string;
        };
        const at = Date.parse(brief.at ?? "");
        return brief.state === "queued" && now - at > WAIT_MS ? [{ name: entry.name, at }] : [];
      } catch {
        return [];
      }
    })
    .sort((a, b) => a.at - b.at)
    .map((piece) => `${piece.name} (${minutes(now - piece.at)})`);
}

/** The report of one sweep, in plain words; null when there is nothing to say. */
export function report(input: {
  ended: (Kill & { ok: boolean })[];
  failedRuns: number;
  waitingRuns: { count: number; oldestMs: number };
  waitingPieces: string[];
  passAlive: boolean;
  runnerAlive: boolean;
}): string | null {
  const lines: string[] = [];
  if (input.ended.length > 0) {
    lines.push(`The laptop's sweep ended ${String(input.ended.length)} stuck process(es):`);
    for (const kill of input.ended)
      lines.push(
        `- ${kill.kind} ${String(kill.pid)}: ${kill.reason}${kill.ok ? "" : " (it could not be ended)"}`,
      );
  }
  if (input.failedRuns > 0)
    lines.push(
      `${String(input.failedRuns)} run(s) the ended runner held are marked failed, so none is claimed again into the same wall.`,
    );
  if (input.waitingRuns.count > 0)
    lines.push(
      `${String(input.waitingRuns.count)} run(s) queued over ${minutes(WAIT_MS)}, the oldest ${minutes(input.waitingRuns.oldestMs)}; the runner is ${input.runnerAlive ? "running" : "not running"}.`,
    );
  if (input.waitingPieces.length > 0)
    lines.push(
      `Studio pieces queued over ${minutes(WAIT_MS)}: ${input.waitingPieces.join(", ")}; a studio pass is ${input.passAlive ? "running" : "not running"}.`,
    );
  return lines.length === 0 ? null : lines.join("\n");
}

async function sweep(dry: boolean): Promise<void> {
  const now = Date.now();
  const say = (line: string) => {
    console.log(`${new Date().toISOString()} ${line}`);
  };
  const procs = listProcesses();
  const kills = planSweep(procs, now, process.pid);
  const ended = kills.map((kill) => ({ ...kill, ok: dry ? false : endTree(kill.pid) }));
  for (const kill of ended)
    say(`${dry ? "would end" : kill.ok ? "ended" : "could not end"} ${kill.kind} ${String(kill.pid)}: ${kill.reason}`);
  writeFileSync(join(HOME, "sweep.heartbeat"), new Date(now).toISOString());
  if (dry) return;

  const after = listProcesses();
  const runnerAlive = after.some((proc) => isBun(proc) && /scripts[\\/]workforce[\\/]daemon\.ts/.test(proc.command));
  const passAlive = after.some((proc) => isBun(proc) && STUDIO_PASS.test(proc.command));
  const pieces = waitingPieces(join(HOME, "studio"), now);

  // The database part needs the network; a laptop offline still ends its stuck processes above.
  let failedRuns = 0;
  let waitingRuns = { count: 0, oldestMs: 0 };
  let client: Db | null = null;
  try {
    const { serviceDb } = await import("./env.ts");
    client = serviceDb();
    const workers = ended
      .filter((kill) => kill.ok && kill.kind === "scheduled pass")
      .map((kill) => runnerWorker(kill.pid));
    if (workers.length > 0) {
      const { data } = await client
        .from("agent_runs")
        .update({
          state: "failed",
          finished_at: new Date().toISOString(),
          lease_until: null,
          error: "stopped: its runner ran past the scheduled task's time limit and the sweep ended it",
        })
        .eq("state", "running")
        .in("worker", workers)
        .select("id");
      failedRuns = data?.length ?? 0;
    }
    const { data: queued } = await client
      .from("agent_runs")
      .select("created_at")
      .eq("state", "queued")
      .lt("created_at", new Date(now - WAIT_MS).toISOString())
      .order("created_at")
      .limit(50);
    if (queued !== null && queued.length > 0)
      waitingRuns = {
        count: queued.length,
        oldestMs: now - Date.parse(queued[0]?.created_at ?? new Date(now).toISOString()),
      };
  } catch (failure: unknown) {
    say(`database not reached: ${failure instanceof Error ? failure.message : String(failure)}`);
  }

  const text = report({ ended, failedRuns, waitingRuns, waitingPieces: pieces, passAlive, runnerAlive });
  if (text === null) return;
  say(text.replaceAll("\n", " | "));
  if (client === null) return;
  // Matter's thread: he reads it, and his digest carries it. A system line queues no run of its own.
  const { error } = await client.from("agent_messages").insert({
    thread: "matter",
    author_kind: "system",
    author_id: "system",
    author_name: "Matter of Place",
    body: text.slice(0, 20000),
  });
  if (error !== null) say(`the sweep's line was not written: ${error.message}`);
}

if (import.meta.main) {
  sweep(process.argv.includes("--dry")).catch((failure: unknown) => {
    console.log(
      `${new Date().toISOString()} sweep failed: ${failure instanceof Error ? failure.message : String(failure)}`,
    );
    process.exitCode = 1;
  });
}
