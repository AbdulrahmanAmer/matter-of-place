// The laptop's cleaner (operator, 2026-10-27: "make sure that they are able to check if things are stuck and clean
// behind them and things shouldn't sit in queue"). The scheduled task "MOP Sweep" (install.ps1) runs it every five
// minutes, apart from the runner, so a runner that hangs cannot stop it. It is the one process that ends stuck work
// (the studio's lock only refuses to start beside a live pass). Each sweep:
//   1. reads every process once and ends, by exact process ids, the workforce processes nobody is waiting for:
//      - a scheduled pass whose task ended it at its time limit: Windows stops the hidden launcher (wscript.exe) and
//        never its children, so the pass ran on and a new one started beside it every minute (P-4660). One still
//        running a colleague's CLI answer is kept until RUN_CEILING_MS (no clock on their work, 2026-10-15; ruling H150)
//        and its run's lease is renewed, so no other runner claims the run it is answering;
//      - every studio pass but one (`reel.ts --pass`; 262 were alive once), keeping the one doing work, and any pass
//        older than PASS_CAP_MS;
//      - a runner's or the live session's CLI child, a studio ffmpeg or a render whose starting process is gone;
//      - an ffmpeg under a pass or a runner older than FFMPEG_CAP_MS;
//   2. fails the runs an ended runner held (its person told in their own thread), and puts back in the queue a studio
//      piece left `working` with no pass alive (failed after its second such return);
//   3. names what waits too long (runs queued, studio pieces queued) with what is in the way;
//   4. says what it found in Matter's thread when that changed, waking him (a stall report: he finds the cause and
//      fixes it), and keeps its lines in ~/.mop-workforce/sweep.log.
//   bun scripts/workforce/sweep.ts        one sweep
//   bun scripts/workforce/sweep.ts --dry  what it would end, ending and writing nothing
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type { Db } from "../../src/server/lib/db.ts";

const HOME = join(homedir(), ".mop-workforce");

/** One process as Windows lists it; `started` in milliseconds. */
export type Proc = { pid: number; parent: number; name: string; started: number; command: string };

/** Processes to end, by exact id (the first is the one the reason is about), and why. */
type Kill = { pids: number[]; kind: string; reason: string };

/** What one sweep decides: what it ends, and the runner passes it keeps because a colleague's answer is under way. */
type Plan = { kills: Kill[]; working: number[] };

/**
 * The scripts a scheduled task starts through hidden-run.vbs (`cmd.exe /c ... bun <script>`) under a time limit, this
 * one included. Matter's live supervisor (scripts/matter/live.ts) is not one: it has no limit, runs without end and
 * keeps itself single (lockOrExit), so one whose launcher is gone is still the one supervisor.
 */
const SCHEDULED =
  /scripts[\\/](?:workforce[\\/](?:daemon|meeting|review|sweep)\.ts|captions-runner\.ts|audit-routine\.ts|usage-push\.ts)/;

/** hidden-run.vbs's own shell line: `cmd.exe /c cd /d "<app>" && bun <script> >> "...\.mop-workforce\<name>.log"`. */
const HIDDEN_RUN_SHELL = /\/c cd \/d .*\.mop-workforce[\\/][\w-]+\.log/i;

/** The studio's own process, started detached by the runner (W7 item 19). */
const STUDIO_PASS = /reel\.ts"?\s+--pass\b/;

/** Render steps of the studio, under the runner's checkout or the studio folder. */
const RENDER = /render-reel\.mjs|still\.mjs|brand-post\.ts|launch[\\/]engine[\\/]/;
const OUR_PATHS = /mop-build|\.mop-workforce/i;

/** No pass of the studio outlives this: past it, reel.ts calls its `working` piece abandoned (STALE_MS, 3 h). */
export const PASS_CAP_MS = 3 * 60 * 60_000 + 15 * 60_000;

/** A colleague's answer still running this long after its runner's task ended is ended with it (ruling H150). */
export const RUN_CEILING_MS = PASS_CAP_MS;

/** The longest render P-2100 measured was 836 s with the laptop loaded; an hour is a hung encoder. */
export const FFMPEG_CAP_MS = 60 * 60_000;

/** A run or a studio piece queued longer than this is named, with what is in its way. */
export const WAIT_MS = 30 * 60_000;

/** A `working` piece younger than this may belong to a pass started after the sweep listed the processes. */
const WORKING_GRACE_MS = 10 * 60_000;

const isBun = (proc: Proc) => /^(bun|node)(\.exe)?$/i.test(proc.name);
const isLauncher = (proc: Proc) => /^wscript\.exe$/i.test(proc.name);
const isFfmpeg = (proc: Proc) => /^ff(mpeg|probe)(\.exe)?$/i.test(proc.name);
const isCli = (proc: Proc) => /^claude(\.exe)?$/i.test(proc.name);
const isStudioPass = (proc: Proc) => isBun(proc) && STUDIO_PASS.test(proc.command);
const isScheduled = (proc: Proc) => isBun(proc) && SCHEDULED.test(proc.command);

/**
 * A CLI child of the runner, the studio or Matter's live session: each names a file of its own (the runner's and the
 * studio's empty MCP files; the live session's stream input with its full settings). Builders Matter starts from his
 * shell carry none of these, and neither does the desktop app or a person's own terminal session.
 */
const isRunnerCli = (proc: Proc) =>
  isCli(proc) &&
  (/(?:studio-)?no-mcp\.json/i.test(proc.command) ||
    (/--input-format\s+stream-json/.test(proc.command) &&
      /settings-full\.json/.test(proc.command)));

const minutes = (ms: number) => `${String(Math.round(ms / 60_000))} min`;

/**
 * What one sweep ends, from one listing of the processes. `self` (the sweep) is never ended. A parent started after its
 * child is a reused process id, so that child counts as orphaned. Ending is by exact ids: a runner's descendants are
 * ended with it, except a studio pass it started (judged on its own), so no stale parent id reaches another process.
 */
export function planSweep(procs: Proc[], now: number, self: number): Plan {
  const byPid = new Map(procs.map((proc) => [proc.pid, proc]));
  const parentOf = (proc: Proc): Proc | undefined => {
    const parent = byPid.get(proc.parent);
    return parent !== undefined && parent.started <= proc.started && parent.pid !== proc.pid
      ? parent
      : undefined;
  };
  const children = new Map<number, Proc[]>();
  for (const proc of procs) {
    const parent = parentOf(proc);
    if (parent !== undefined) children.set(parent.pid, [...(children.get(parent.pid) ?? []), proc]);
  }
  /** The process and everything under it, a studio pass under another process left out with its own tree. */
  const tree = (root: Proc): Proc[] => {
    const found: Proc[] = [];
    const walk = (proc: Proc) => {
      found.push(proc);
      for (const child of children.get(proc.pid) ?? []) if (!isStudioPass(child)) walk(child);
    };
    walk(root);
    return found;
  };
  const ancestors = (proc: Proc): Proc[] => {
    const found: Proc[] = [];
    for (let at = parentOf(proc); at !== undefined && found.length < 64; at = parentOf(at))
      found.push(at);
    return found;
  };
  const busy = (proc: Proc) =>
    tree(proc).some((under) => under !== proc && (isCli(under) || isFfmpeg(under) || isBun(under)));

  const kills: Kill[] = [];
  const taken = new Set<number>();
  const end = (root: Proc, kind: string, reason: string) => {
    if (root.pid === self || taken.has(root.pid)) return;
    const pids = tree(root)
      .map((proc) => proc.pid)
      .filter((pid) => pid !== self && !taken.has(pid));
    for (const pid of pids) taken.add(pid);
    kills.push({ pids, kind, reason });
  };
  const working: number[] = [];

  // One studio pass at a time: past its cap a pass ends; of the rest the oldest doing work stays (or the oldest).
  const passes = procs.filter(isStudioPass).sort((a, b) => a.started - b.started);
  const young = passes.filter((pass) => now - pass.started <= PASS_CAP_MS);
  const keeper = young.find(busy) ?? young[0];
  for (const pass of passes) {
    if (now - pass.started > PASS_CAP_MS)
      end(
        pass,
        "studio pass",
        `running ${minutes(now - pass.started)}, past ${minutes(PASS_CAP_MS)}`,
      );
    else if (pass !== keeper)
      end(pass, "studio pass", "a second studio pass; the studio makes one at a time");
  }

  for (const proc of procs) {
    if (taken.has(proc.pid) || isStudioPass(proc)) continue;
    const parent = parentOf(proc);
    if (isScheduled(proc)) {
      // hidden-run.vbs: wscript.exe waits on cmd.exe, which runs bun. With the launcher gone, the task has ended.
      const shell =
        parent !== undefined && HIDDEN_RUN_SHELL.test(parent.command) ? parent : undefined;
      const launcher = shell === undefined ? undefined : parentOf(shell);
      if (shell === undefined || (launcher !== undefined && isLauncher(launcher))) continue;
      const age = now - proc.started;
      const answering = tree(proc).some(isRunnerCli);
      if (answering && age <= RUN_CEILING_MS) working.push(proc.pid);
      else
        end(
          proc,
          "scheduled pass",
          answering
            ? `its scheduled task ended at the time limit and a colleague's answer under it ran past ${minutes(RUN_CEILING_MS)}`
            : `its scheduled task ended at the time limit, but it ran on for ${minutes(age)} with no answer under way`,
        );
      continue;
    }
    if (parent === undefined) {
      if (isRunnerCli(proc))
        end(
          proc,
          "CLI run",
          "the runner or session that started it is gone, so nobody reads its answer",
        );
      else if (isFfmpeg(proc) && OUR_PATHS.test(proc.command))
        end(proc, "ffmpeg", "the studio pass that started it is gone");
      else if (isBun(proc) && RENDER.test(proc.command) && OUR_PATHS.test(proc.command))
        end(proc, "render", "the studio pass that started it is gone");
      continue;
    }
    if (
      isFfmpeg(proc) &&
      now - proc.started > FFMPEG_CAP_MS &&
      ancestors(proc).some((above) => isStudioPass(above) || isScheduled(above))
    )
      end(proc, "ffmpeg", `running ${minutes(now - proc.started)}, past ${minutes(FFMPEG_CAP_MS)}`);
  }
  return { kills, working };
}

const rowsSchema = z.array(
  z.object({
    pid: z.number(),
    parent: z.number(),
    name: z.string(),
    started: z.string(),
    command: z.string().nullable(),
  }),
);

/** Every process, from one PowerShell call (times in UTC, so no locale reads them). */
function listProcesses(): Proc[] {
  const script =
    // -InputObject @(...): a list of one stays a list (piped, ConvertTo-Json would write the lone object)
    "ConvertTo-Json -Compress -InputObject @(Get-CimInstance Win32_Process | ForEach-Object { [pscustomobject]@{ pid = [int]$_.ProcessId; parent = [int]$_.ParentProcessId; " +
    "name = [string]$_.Name; started = $(if ($_.CreationDate) { $_.CreationDate.ToUniversalTime().ToString('o') } else { '' }); " +
    "command = [string]$_.CommandLine } })";
  const listed = spawnSync("powershell", ["-NoProfile", "-Command", script], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 60_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (listed.status !== 0) throw new Error("sweep: the process list could not be read");
  // PowerShell 5.1 leaves control characters in a command line unescaped (a prompt passed as an argument held \x1a on
  // 2026-10-27), which JSON refuses; the listing is one line, so a space in their place changes nothing else.
  // eslint-disable-next-line no-control-regex -- matching the control characters is the point
  const text = listed.stdout.replace(/[\u0000-\u001f]/g, " ");
  const parsed: unknown = JSON.parse(text);
  return rowsSchema.parse(parsed).map((row) => ({
    pid: row.pid,
    parent: row.parent,
    name: row.name,
    started: row.started === "" ? 0 : Date.parse(row.started),
    command: row.command ?? "",
  }));
}

/** Ends exact processes, fifty to a call (one call per process would outlast the task's limit on a pegged laptop). */
function endProcesses(pids: number[]): void {
  for (let at = 0; at < pids.length; at += 50) {
    const batch = pids.slice(at, at + 50).flatMap((pid) => ["/PID", String(pid)]);
    spawnSync("taskkill", ["/F", ...batch], { windowsHide: true, timeout: 60_000 });
  }
}

/** The runner's claim name for a process id (daemon.ts: `${hostname()}:${pid}`). */
export const runnerWorker = (pid: number) => `${hostname()}:${String(pid)}`;

const briefSchema = z.object({ state: z.string(), at: z.string() }).passthrough();

function readBriefFile(folder: string): z.infer<typeof briefSchema> | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(folder, "brief.json"), "utf8"));
    return briefSchema.parse(parsed);
  } catch {
    return null;
  }
}

function folders(studio: string): string[] {
  if (!existsSync(studio)) return [];
  return readdirSync(studio, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(studio, entry.name));
}

/** Studio pieces queued longer than WAIT_MS, oldest first, as "folder (N min)". */
export function waitingPieces(studio: string, now: number): string[] {
  return folders(studio)
    .flatMap((folder) => {
      const brief = readBriefFile(folder);
      const at = Date.parse(brief?.at ?? "");
      return brief?.state === "queued" && now - at > WAIT_MS
        ? [{ name: folder.split(/[\\/]/).pop() ?? folder, at }]
        : [];
    })
    .sort((a, b) => a.at - b.at)
    .map((piece) => `${piece.name} (${minutes(now - piece.at)})`);
}

const RETURNED = "returned to the queue by the sweep: no pass was making it";

/**
 * With no studio pass alive, a piece still `working` (and older than WORKING_GRACE_MS) has nobody making it: it goes
 * back to the queue, and fails the second time, so a piece that hangs every pass does not loop. Answers the names.
 */
export function returnOrphanedPieces(studio: string, now: number): string[] {
  const touched: string[] = [];
  for (const folder of folders(studio)) {
    const brief = readBriefFile(folder);
    if (brief?.state !== "working") continue;
    const started = typeof brief["started"] === "string" ? Date.parse(brief["started"]) : NaN;
    if (!(now - (Number.isNaN(started) ? Date.parse(brief.at) : started) > WORKING_GRACE_MS))
      continue;
    const before = typeof brief["reason"] === "string" ? brief["reason"] : "";
    const next: Record<string, unknown> = { ...brief };
    next["started"] = undefined;
    if (before.startsWith(RETURNED)) {
      next["state"] = "failed";
      next["reason"] = "abandoned twice: its pass stopped while making it";
    } else {
      next["state"] = "queued";
      next["reason"] = RETURNED;
    }
    writeFileSync(join(folder, "brief.json"), JSON.stringify(next, null, 2));
    touched.push(`${folder.split(/[\\/]/).pop() ?? folder} (${String(next["state"])})`);
  }
  return touched;
}

/** The report of one sweep, in plain words; null when there is nothing to say. */
export function report(input: {
  ended: (Kill & { ok: boolean })[];
  failedRuns: number;
  pieces: string[];
  waitingRuns: { count: number; oldestMs: number };
  waitingPieces: string[];
  passAlive: boolean;
  runnerAlive: boolean;
}): string | null {
  const lines: string[] = [];
  if (input.ended.length > 0) {
    lines.push(`MOP Sweep ended ${String(input.ended.length)} stuck process tree(s):`);
    for (const kill of input.ended)
      lines.push(
        `- ${kill.kind} ${String(kill.pids[0] ?? 0)}: ${kill.reason}${kill.ok ? "" : " (it could not be ended)"}`,
      );
  }
  if (input.failedRuns > 0)
    lines.push(
      `${String(input.failedRuns)} run(s) the ended runner held are marked failed, so none is claimed again into the same wall.`,
    );
  if (input.pieces.length > 0)
    lines.push(`Studio pieces nobody was making: ${input.pieces.join(", ")}.`);
  if (input.waitingRuns.count > 0)
    lines.push(
      `${String(input.waitingRuns.count)} run(s) queued over ${minutes(WAIT_MS)}, the oldest ${minutes(input.waitingRuns.oldestMs)}; the runner ${input.runnerAlive ? "is passing" : "has not passed in 5 minutes"}.`,
    );
  if (input.waitingPieces.length > 0)
    lines.push(
      `Studio pieces queued over ${minutes(WAIT_MS)}: ${input.waitingPieces.join(", ")}; a studio pass is ${input.passAlive ? "running" : "not running"}.`,
    );
  if (lines.length === 0) return null;
  lines.push("Find why it hung and fix the cause.");
  return lines.join("\n");
}

/** What a report is about, without its minutes: the same stall is said once, not every five minutes. */
export function reportKey(text: string): string {
  return createHash("sha256")
    .update(text.replace(/\d+ min\b/g, "N min"))
    .digest("hex");
}

async function sweep(dry: boolean): Promise<void> {
  const now = Date.now();
  const say = (line: string) => {
    console.log(`${new Date().toISOString()} ${line}`);
  };
  const { kills, working } = planSweep(listProcesses(), now, process.pid);
  for (const kill of kills)
    say(`${dry ? "would end" : "ending"} ${kill.kind} ${kill.pids.join(",")}: ${kill.reason}`);
  if (dry) {
    for (const pid of working)
      say(`would keep scheduled pass ${String(pid)}: an answer is under way`);
    return;
  }
  mkdirSync(HOME, { recursive: true });
  endProcesses(kills.flatMap((kill) => kill.pids));
  const after = listProcesses();
  const alive = new Set(after.map((proc) => proc.pid));
  const ended = kills.map((kill) => ({ ...kill, ok: !alive.has(kill.pids[0] ?? 0) }));
  writeFileSync(join(HOME, "sweep.heartbeat"), new Date(now).toISOString());

  const passAlive = after.some(isStudioPass);
  const studio = join(HOME, "studio");
  const pieces = passAlive ? [] : returnOrphanedPieces(studio, now);
  const log = join(HOME, "daemon.log");
  const runnerAlive = existsSync(log) && now - statSync(log).mtimeMs < 5 * 60_000;

  // The database part needs the network; a laptop offline still ends its stuck processes above.
  let failedRuns = 0;
  let waitingRuns = { count: 0, oldestMs: 0 };
  let client: Db | null = null;
  try {
    const { serviceDb } = await import("./env.ts");
    client = serviceDb();
    const killedRunners = ended.filter((kill) => kill.ok && kill.kind === "scheduled pass");
    for (const kill of killedRunners) {
      // a runner that started on the same pid after the kill holds leases from after it, which this leaves alone
      const { data } = await client
        .from("agent_runs")
        .update({
          state: "failed",
          finished_at: new Date().toISOString(),
          lease_until: null,
          error:
            "stopped: its runner ran past the scheduled task's time limit and the sweep ended it",
        })
        .eq("state", "running")
        .eq("worker", runnerWorker(kill.pids[0] ?? 0))
        .lte("lease_until", new Date(now + 3000_000).toISOString())
        .select("message_id");
      failedRuns += data?.length ?? 0;
      for (const run of data ?? []) await tellAuthor(client, run.message_id);
    }
    // a colleague's answer under a runner whose task ended keeps its run, so no other runner claims it again
    for (const pid of working)
      await client
        .from("agent_runs")
        .update({ lease_until: new Date(now + 3000_000).toISOString() })
        .eq("state", "running")
        .eq("worker", runnerWorker(pid));
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

  const text = report({
    ended,
    failedRuns,
    pieces,
    waitingRuns,
    waitingPieces: waitingPieces(studio, now),
    passAlive,
    runnerAlive,
  });
  if (text === null) return;
  say(text.replaceAll("\n", " | "));
  // Said once per stall (say-a-wait-once): the same report with only its minutes changed is not posted again.
  const keyFile = join(HOME, "sweep-last.txt");
  const key = reportKey(text);
  if (client === null || (existsSync(keyFile) && readFileSync(keyFile, "utf8") === key)) return;
  if (await tellMatter(client, text)) writeFileSync(keyFile, key);
}

/** A person whose line a stopped run was answering hears it in their own thread (as the runner's failures say, P-3453). */
async function tellAuthor(client: Db, messageId: string | null): Promise<void> {
  if (messageId === null) return;
  const { data: line } = await client
    .from("agent_messages")
    .select("thread, author_kind")
    .eq("id", messageId)
    .single();
  if (line?.author_kind !== "human") return;
  await client.from("agent_messages").insert({
    thread: line.thread,
    author_kind: "system",
    author_id: "system",
    author_name: "Matter of Place",
    body: "Your line could not be finished: the run answering it hung past its time limit and was stopped. Please send it again.",
  });
}

/** Matter's thread, and a run that wakes him on it (a line alone queues nothing, P-4662; reel.ts tellMatter's way). */
async function tellMatter(client: Db, body: string): Promise<boolean> {
  const { data: line } = await client
    .from("agent_messages")
    .insert({
      thread: "matter",
      author_kind: "system",
      author_id: "system",
      author_name: "Matter of Place",
      body: body.slice(0, 20000),
    })
    .select("id")
    .single();
  const { data: matter } = await client.from("agents").select("id").eq("slug", "matter").single();
  if (line === null || matter === null) return false;
  const { error } = await client
    .from("agent_runs")
    .insert({ agent_id: matter.id, cause: "message", message_id: line.id });
  return error === null;
}

if (import.meta.main) {
  // The task's own limit ends only its launcher (P-4660), so the sweep ends itself first.
  setTimeout(() => {
    console.log(`${new Date().toISOString()} sweep: past 3.5 minutes, ending itself`);
    process.exit(2);
  }, 210_000).unref();
  sweep(process.argv.includes("--dry")).catch((failure: unknown) => {
    console.log(
      `${new Date().toISOString()} sweep failed: ${failure instanceof Error ? failure.message : String(failure)}`,
    );
    process.exitCode = 1;
  });
}
