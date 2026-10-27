// The laptop's cleaner (operator, 2026-10-27: "make sure that they are able to check if things are stuck and clean
// behind them and things shouldn't sit in queue"). The scheduled task "MOP Sweep" (install.ps1) runs it every five
// minutes, apart from the runner, so a runner that hangs cannot stop it. It is the one process that ends stuck work
// (the studio's lock only refuses to start beside a live pass). Each sweep:
//   1. reads every process once and ends, by exact process ids, the workforce processes nobody is waiting for:
//      - a scheduled pass past RUN_CEILING_MS (ruling H150; the tasks themselves have no time limit, P-4660), and one
//        whose launcher is gone (its task was stopped, or a limit of an older install ended only the launcher);
//      - every studio pass but one (`reel.ts --pass`; 262 were alive once), keeping the one making a piece, and any
//        pass older than PASS_CAP_MS;
//      - a runner's or the live session's CLI child, a studio ffmpeg or a render whose starting process is gone;
//      - an ffmpeg under a pass or a runner older than FFMPEG_CAP_MS;
//   2. settles the runs an ended runner held: back to the queue when its task was stopped, failed (its person told in
//      their own thread) when it hung past the ceiling; puts back in the queue a studio piece left `working` with no
//      pass alive (failed after its second such return);
//   3. names what waits too long (runs queued, studio pieces queued) with what is in the way;
//   4. hands what it found to Matter's live session once per stall (~/.mop-workforce/matter/stall.md, read by live.ts
//      between turns: he finds the cause and fixes it), shows it in his thread, and keeps its lines in sweep.log.
//   bun scripts/workforce/sweep.ts        one sweep
//   bun scripts/workforce/sweep.ts --dry  what it would end, ending and writing nothing
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type { Db } from "../../src/server/lib/db.ts";

const HOME = join(homedir(), ".mop-workforce");

/** Where the sweep leaves a stall report for Matter's live session (live.ts STALL_FILE reads and removes it). */
export const STALL_FILE = join(HOME, "matter", "stall.md");

/** One process as Windows lists it; `started` in milliseconds. */
export type Proc = { pid: number; parent: number; name: string; started: number; command: string };

/**
 * Processes to end, by exact id (the first is the one the reason is about), and why. `runs` says what becomes of the
 * runs an ended runner held: `requeue` when its task was stopped under it, `fail` when it hung past the ceiling; `lease`
 * is the lease of the run read before the kill, so a run the pass claimed after that read is never failed with it.
 */
/** The run a pass holds: when it claimed it, and its lease exactly as the database wrote it (microseconds kept). */
export type Claim = { at: number; lease: string };

type Kill = {
  pids: number[];
  kind: string;
  reason: string;
  runs?: "requeue" | "fail";
  lease?: string;
};

/**
 * The scripts a scheduled task starts through hidden-run.vbs (`cmd.exe /c ... bun <script>`), this one included, and
 * the nightly backup ("MOP Backup", registered outside install.ps1 with a limit of its own).
 */
const SCHEDULED =
  /scripts[\\/](?:workforce[\\/](?:daemon|meeting|review|sweep)\.ts|captions-runner\.ts|audit-routine\.ts|usage-push\.ts)|\.mop-workforce[\\/]backup-local\.mjs/;

/** hidden-run.vbs's own shell line: `cmd.exe /c cd /d "<app>" && bun <script> >> "...\.mop-workforce\<name>.log"`. */
const HIDDEN_RUN_SHELL = /\/c cd \/d .*\.mop-workforce[\\/][\w-]+\.log/i;

/** The studio's own process, started detached by the runner (W7 item 19). */
const STUDIO_PASS = /reel\.ts"?\s+--pass\b/;

/** Render steps of the studio, and the folders only the runner's checkout and the studio use. */
const RENDER = /render-reel\.mjs|still\.mjs|brand-post\.ts|launch[\\/]engine[\\/]/;
const STUDIO_PATHS = /\.mop-workforce[\\/]studio|mop-build[\\/]live[\\/]/i;

/** No pass of the studio outlives this: past it, reel.ts calls its `working` piece abandoned (STALE_MS, 3 h). */
export const PASS_CAP_MS = 3 * 60 * 60_000 + 15 * 60_000;

/**
 * A scheduled pass still running this long has hung (ruling H150): Matter's longest run is 45 minutes, and a pass makes
 * up to five runs. The same length as PASS_CAP_MS, written out (knip refuses one export that is another).
 */
export const RUN_CEILING_MS = 195 * 60_000;

/** The longest render P-2100 measured was 836 s with the laptop loaded; an hour is a hung encoder. */
export const FFMPEG_CAP_MS = 60 * 60_000;

/** A run or a studio piece queued longer than this is named, with what is in its way. */
export const WAIT_MS = 30 * 60_000;

/** A process or a `working` piece younger than this may belong to work started after the listing. */
const GRACE_MS = 10 * 60_000;

const isBun = (proc: Proc) => /^(bun|node)(\.exe)?$/i.test(proc.name);
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

/** A process's parent, or undefined when it is gone or its id was reused (a parent started after its child). */
function parentFinder(byPid: ReadonlyMap<number, Proc>): (proc: Proc) => Proc | undefined {
  return (proc) => {
    const parent = byPid.get(proc.parent);
    return parent !== undefined && parent.started <= proc.started && parent.pid !== proc.pid
      ? parent
      : undefined;
  };
}

/** The scheduled passes still under their hidden-run launcher (cmd.exe under a live parent), oldest first. */
export function launchedPasses(procs: Proc[]): Proc[] {
  const parentOf = parentFinder(new Map(procs.map((proc) => [proc.pid, proc])));
  return procs
    .filter((proc) => {
      const shell = isScheduled(proc) ? parentOf(proc) : undefined;
      return (
        shell !== undefined && HIDDEN_RUN_SHELL.test(shell.command) && parentOf(shell) !== undefined
      );
    })
    .sort((a, b) => a.started - b.started);
}

/**
 * What one sweep ends, from one listing of the processes. `self` (the sweep) is never ended. A parent started after its
 * child is a reused process id, so that child counts as orphaned. Ending is by exact ids: a runner's descendants are
 * ended with it, except a studio pass it started (judged on its own), so no stale parent id reaches another process.
 * `claims` maps a launched pass past RUN_CEILING_MS to when it claimed the run it holds (null: it holds none); a pass
 * with no entry is unknown and never ended for its age, since the ceiling is on the run (H150), not on the pass.
 */
export function planSweep(
  procs: Proc[],
  now: number,
  self: number,
  claims: ReadonlyMap<number, Claim | null> = new Map(),
  lock: { pid: number; started: number } | null = null,
): Kill[] {
  const byPid = new Map(procs.map((proc) => [proc.pid, proc]));
  const parentOf = parentFinder(byPid);
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

  const kills: Kill[] = [];
  const taken = new Set<number>();
  const end = (root: Proc, kind: string, reason: string, runs?: Kill["runs"], lease?: string) => {
    if (root.pid === self || taken.has(root.pid)) return;
    const pids = tree(root)
      .map((proc) => proc.pid)
      .filter((pid) => pid !== self && !taken.has(pid));
    for (const pid of pids) taken.add(pid);
    const kill: Kill = { pids, kind, reason };
    if (runs !== undefined) kill.runs = runs;
    if (lease !== undefined) kill.lease = lease;
    kills.push(kill);
  };

  // One studio pass at a time: past its cap a pass ends. Of the rest the one making a piece stays (its designer or
  // reviewer is a CLI under it), else the oldest with any work under it, else the newest (an old one with nothing
  // under it is the one that hung before its piece was `working`).
  const passes = procs.filter(isStudioPass).sort((a, b) => a.started - b.started);
  const young = passes.filter((pass) => now - pass.started <= PASS_CAP_MS);
  const under = (pass: Proc) => tree(pass).filter((proc) => proc !== pass);
  const keeper =
    // the pass holding the studio's lock (reel.ts STUDIO_LOCK, its id and start) is the one the studio runs
    young.find(
      (pass) =>
        lock !== null && pass.pid === lock.pid && Math.abs(pass.started - lock.started) < 10_000,
    ) ??
    young.find((pass) => under(pass).some(isCli)) ??
    young.find((pass) => under(pass).length > 0) ??
    young.at(-1);
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
      // hidden-run.vbs: wscript.exe waits on cmd.exe, which runs bun. A pass started by hand is none of the sweep's.
      if (parent === undefined || !HIDDEN_RUN_SHELL.test(parent.command)) continue;
      const age = now - proc.started;
      if (parentOf(parent) === undefined)
        end(
          proc,
          "scheduled pass",
          `its scheduled task was stopped ${minutes(age)} into it, but the pass ran on`,
          "requeue",
        );
      else if (age > RUN_CEILING_MS) {
        const claimed = claims.get(proc.pid);
        // unknown, or a run claimed under the ceiling: no clock on a colleague's answer below it (2026-10-15)
        if (claimed === undefined || (claimed !== null && now - claimed.at <= RUN_CEILING_MS))
          continue;
        // holding no run when read, it has no run to fail (one it claims after the read is left for its lease)
        if (claimed === null)
          end(proc, "scheduled pass", `running ${minutes(age)} and holding no run`);
        else
          end(
            proc,
            "scheduled pass",
            `its run has been answering ${minutes(now - claimed.at)}, past its ceiling of ${minutes(RUN_CEILING_MS)}`,
            "fail",
            claimed.lease,
          );
      }
      continue;
    }
    if (parent === undefined) {
      if (isRunnerCli(proc))
        end(
          proc,
          "CLI run",
          "the runner or session that started it is gone, so nobody reads its answer",
        );
      else if (now - proc.started > GRACE_MS && isFfmpeg(proc) && STUDIO_PATHS.test(proc.command))
        end(proc, "ffmpeg", "the studio pass that started it is gone");
      else if (
        now - proc.started > GRACE_MS &&
        isBun(proc) &&
        RENDER.test(proc.command) &&
        STUDIO_PATHS.test(proc.command)
      )
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
  return kills;
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

/** The runner's pass now running under its task (`daemon.ts`), from the listing; null when none is alive. */
export function runnerPass(procs: Proc[], now: number): { pid: number; ageMs: number } | null {
  const pass = launchedPasses(procs).find((proc) => /daemon\.ts/.test(proc.command));
  return pass === undefined ? null : { pid: pass.pid, ageMs: now - pass.started };
}

/** A JSON file of the workforce folder, or null when it is missing or not that shape. */
function readJson<T>(name: string, schema: z.ZodType<T>): T | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(HOME, name), "utf8"));
    return schema.parse(parsed);
  } catch {
    return null;
  }
}

/** True while the usage breaker holds every claim (cli.ts breaker.json, with its end): no waiting run is a stall. */
function breakerHolds(now: number): boolean {
  const breaker = readJson("breaker.json", z.object({ until: z.string() }));
  return breaker !== null && Date.parse(breaker.until) > now;
}

/** True when the staff policy takes a person's line only (config.ts policy.json, over 90% of the allowance). */
function personOnly(): boolean {
  return readJson("policy.json", z.object({ personOnly: z.boolean() }))?.personOnly === true;
}

/** The studio pass holding reel.ts's lock (~/.mop-workforce/studio.lock: its id and start); null when none holds it. */
function studioLock(): { pid: number; started: number } | null {
  return readJson("studio.lock", z.object({ pid: z.number(), started: z.number() }));
}

/**
 * How a waiting report keys the runner: one pass held past the wait, by its id, or "not held". A runner that passes
 * every minute is seen alive or gone at random by a sweep, so both are one shape (else the report flips each sweep).
 */
export function runnerShape(runner: Findings["runner"]): string | number {
  return runner !== null && runner.ageMs > WAIT_MS ? runner.pid : "not held";
}

/**
 * When each pass claimed the run it holds (a lease is its claim plus 3000 s, daemon.ts runOnce); null when it holds
 * none. A pass whose runs cannot be read is left out, and so is never ended for its age.
 */
async function readClaims(client: Db, pids: number[]): Promise<Map<number, Claim | null>> {
  const claims = new Map<number, Claim | null>();
  for (const pid of pids) {
    const { data, error } = await client
      .from("agent_runs")
      .select("lease_until")
      .eq("state", "running")
      .eq("worker", runnerWorker(pid))
      .order("lease_until", { ascending: false })
      .limit(1);
    if (error !== null) continue;
    const lease = data[0]?.lease_until;
    claims.set(
      pid,
      lease === undefined || lease === null ? null : { at: Date.parse(lease) - 3000_000, lease },
    );
  }
  return claims;
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

const nameOf = (folder: string) => folder.split(/[\\/]/).pop() ?? folder;

/** Studio pieces queued longer than WAIT_MS, oldest first, as "folder (N min)". */
export function waitingPieces(studio: string, now: number): string[] {
  return folders(studio)
    .flatMap((folder) => {
      const brief = readBriefFile(folder);
      const at = Date.parse(brief?.at ?? "");
      return brief?.state === "queued" && now - at > WAIT_MS ? [{ name: nameOf(folder), at }] : [];
    })
    .sort((a, b) => a.at - b.at)
    .map((piece) => `${piece.name} (${minutes(now - piece.at)})`);
}

const RETURNED = "returned to the queue by the sweep: no pass was making it";

/**
 * With no studio pass alive, a piece still `working` (and older than GRACE_MS) has nobody making it: it goes back to
 * the queue, and fails the second time, so a piece that hangs every pass does not loop. Answers the names.
 */
export function returnOrphanedPieces(studio: string, now: number): string[] {
  const touched: string[] = [];
  for (const folder of folders(studio)) {
    const brief = readBriefFile(folder);
    if (brief?.state !== "working") continue;
    const started = typeof brief["started"] === "string" ? Date.parse(brief["started"]) : NaN;
    if (!(now - (Number.isNaN(started) ? Date.parse(brief.at) : started) > GRACE_MS)) continue;
    const before = typeof brief["reason"] === "string" ? brief["reason"] : "";
    const next: Record<string, unknown> = { ...brief, started: undefined };
    if (before.startsWith(RETURNED)) {
      next["state"] = "failed";
      next["reason"] = "abandoned twice: its pass stopped while making it";
    } else {
      next["state"] = "queued";
      next["reason"] = RETURNED;
    }
    writeFileSync(join(folder, "brief.json"), JSON.stringify(next, null, 2));
    touched.push(`${nameOf(folder)} (${String(next["state"])})`);
  }
  return touched;
}

/** What a sweep found, for its report. */
export type Findings = {
  ended: (Kill & { ok: boolean })[];
  settled: { requeued: number; failed: number };
  pieces: string[];
  /** Runs a colleague can take (idle or working) queued over WAIT_MS; none while the usage breaker holds claims. */
  waitingRuns: { count: number; oldestMs: number; oldestId: string };
  waitingPieces: string[];
  passAlive: boolean;
  /** The runner's pass alive now, from the listing (a scheduled task's LastRunTime moves on refused starts too). */
  runner: { pid: number; ageMs: number } | null;
};

/** The report of one sweep, in plain words; null when there is nothing to say. */
export function report(found: Findings): string | null {
  const lines: string[] = [];
  if (found.ended.length > 0) {
    lines.push(`MOP Sweep ended ${String(found.ended.length)} stuck process tree(s):`);
    for (const kill of found.ended)
      lines.push(
        `- ${kill.kind} ${String(kill.pids[0] ?? 0)}: ${kill.reason}${kill.ok ? "" : " (it could not be ended)"}`,
      );
  }
  if (found.settled.requeued > 0)
    lines.push(
      `${String(found.settled.requeued)} run(s) the stopped runner held are back in the queue.`,
    );
  if (found.settled.failed > 0)
    lines.push(
      `${String(found.settled.failed)} run(s) the hung runner held are marked failed; each person was told in their thread.`,
    );
  if (found.pieces.length > 0)
    lines.push(`Studio pieces nobody was making: ${found.pieces.join(", ")}.`);
  if (found.waitingRuns.count > 0)
    lines.push(
      `${String(found.waitingRuns.count)} run(s) a colleague can take queued over ${minutes(WAIT_MS)}, the oldest ${minutes(found.waitingRuns.oldestMs)} (${found.waitingRuns.oldestId}); ${found.runner === null ? "no runner pass is alive" : `the runner pass ${String(found.runner.pid)} has been running ${minutes(found.runner.ageMs)}`}.`,
    );
  if (found.waitingPieces.length > 0)
    lines.push(
      `Studio pieces queued over ${minutes(WAIT_MS)}: ${found.waitingPieces.join(", ")}; a studio pass is ${found.passAlive ? "running" : "not running"}.`,
    );
  if (lines.length === 0) return null;
  lines.push("Find why it hung and fix the cause.");
  return lines.join("\n");
}

/**
 * What a report is about, without its numbers that grow or the ids of passes that come and go: the same stall is said
 * once (say-a-wait-once), and said again only when what is stuck changes: another kind of process ended, a runner pass held
 * past the wait, other pieces.
 */
export function reportKey(found: Findings): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        [...new Set(found.ended.map((kill) => kill.kind))].sort(),
        found.settled.requeued > 0,
        found.settled.failed > 0,
        found.pieces.map((piece) => piece.replace(/ \((queued|failed)\)$/, "")),
        // a runner that passes every minute is a new process each time: one shape, "cycling"; only a pass that has
        // itself run past the wait is named by its id
        found.waitingRuns.count > 0 ? runnerShape(found.runner) : null,
        found.waitingPieces.map((piece) => piece.replace(/ \(\d+ min\)$/, "")),
      ]),
    )
    .digest("hex");
}

/** The runs of a list that answer a person's own line, in the list's order. */
async function personLines<T extends { message_id: string | null }>(
  client: Db,
  runs: T[],
): Promise<T[]> {
  const ids = runs.flatMap((run) => (run.message_id === null ? [] : [run.message_id]));
  if (ids.length === 0) return [];
  const { data } = await client
    .from("agent_messages")
    .select("id")
    .in("id", ids)
    .eq("author_kind", "human");
  const people = new Set((data ?? []).map((line) => line.id));
  return runs.filter((run) => run.message_id !== null && people.has(run.message_id));
}

/** A person whose line a hung run was answering hears it in their own thread (as the runner's failures say, P-3453). */
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
    body: "Your line could not be finished: the run answering it hung for hours and was stopped. Please send it again.",
  });
}

/** Settles the runs ended runners held; a runner that started on the same id after the kill is left alone. */
export async function settleRuns(
  client: Db,
  ended: (Kill & { ok: boolean })[],
  killedAt: number,
): Promise<Findings["settled"]> {
  const settled = { requeued: 0, failed: 0 };
  for (const kill of ended) {
    if (!kill.ok || kill.runs === undefined) continue;
    const held = client
      .from("agent_runs")
      .update(
        kill.runs === "requeue"
          ? { state: "queued", worker: null, lease_until: null }
          : {
              state: "failed",
              finished_at: new Date(killedAt).toISOString(),
              lease_until: null,
              error: "stopped: its runner hung past the ceiling and the sweep ended it",
            },
      )
      .eq("state", "running")
      .eq("worker", runnerWorker(kill.pids[0] ?? 0))
      .lte("lease_until", kill.lease ?? new Date(killedAt + 3000_000).toISOString());
    const { data } = await held.select("message_id");
    if (kill.runs === "requeue") settled.requeued += data?.length ?? 0;
    else {
      settled.failed += data?.length ?? 0;
      for (const run of data ?? []) await tellAuthor(client, run.message_id);
    }
  }
  return settled;
}

async function sweep(dry: boolean): Promise<void> {
  const now = Date.now();
  const say = (line: string) => {
    console.log(`${new Date().toISOString()} ${line}`);
  };
  const procs = listProcesses();
  // The database part needs the network; a laptop offline still ends its stuck processes below.
  let client: Db | null = null;
  let claims = new Map<number, Claim | null>();
  try {
    const { serviceDb } = await import("./env.ts");
    client = serviceDb();
    const old = launchedPasses(procs).filter((pass) => now - pass.started > RUN_CEILING_MS);
    if (old.length > 0)
      claims = await readClaims(
        client,
        old.map((pass) => pass.pid),
      );
  } catch (failure: unknown) {
    say(`database not reached: ${failure instanceof Error ? failure.message : String(failure)}`);
  }
  const kills = planSweep(procs, now, process.pid, claims, studioLock());
  for (const kill of kills)
    say(`${dry ? "would end" : "ending"} ${kill.kind} ${kill.pids.join(",")}: ${kill.reason}`);
  if (dry) return;
  mkdirSync(join(HOME, "matter"), { recursive: true });
  const killedAt = Date.now();
  endProcesses(kills.flatMap((kill) => kill.pids));
  const after = listProcesses();
  const alive = new Set(after.map((proc) => proc.pid));
  const ended = kills.map((kill) => ({ ...kill, ok: !alive.has(kill.pids[0] ?? 0) }));
  writeFileSync(join(HOME, "sweep.heartbeat"), new Date(now).toISOString());

  const passAlive = after.some(isStudioPass);
  const studio = join(HOME, "studio");
  const pieces = passAlive ? [] : returnOrphanedPieces(studio, now);

  let settled = { requeued: 0, failed: 0 };
  let waitingRuns = { count: 0, oldestMs: 0, oldestId: "" };
  try {
    if (client !== null) {
      settled = await settleRuns(client, ended, killedAt);
      // runs that wait by design are not a stall: a paused or off colleague's, and every run while the breaker holds
      const { data: listed } = breakerHolds(now)
        ? { data: [] }
        : await client
            .from("agent_runs")
            .select("id, created_at, message_id, agents!inner(state)")
            .eq("state", "queued")
            .in("agents.state", ["idle", "working"])
            .lt("created_at", new Date(now - WAIT_MS).toISOString())
            .order("created_at")
            .limit(50);
      // over 90% of the allowance only a person's line is taken (claim_agent_run p_person_only): only those count then
      const queued = personOnly() ? await personLines(client, listed ?? []) : listed;
      const oldest = queued?.[0];
      if (queued !== null && oldest !== undefined)
        waitingRuns = {
          count: queued.length,
          oldestMs: now - Date.parse(oldest.created_at),
          oldestId: oldest.id,
        };
    }
  } catch (failure: unknown) {
    say(`database not reached: ${failure instanceof Error ? failure.message : String(failure)}`);
  }

  const found: Findings = {
    ended,
    settled,
    pieces,
    waitingRuns,
    waitingPieces: waitingPieces(studio, now),
    passAlive,
    runner: runnerPass(after, now),
  };
  const keyFile = join(HOME, "sweep-last.txt");
  const text = report(found);
  if (text === null) {
    // a quiet sweep forgets the last stall, so the same stall later is said again
    rmSync(keyFile, { force: true });
    return;
  }
  say(text.replaceAll("\n", " | "));
  const key = reportKey(found);
  if (existsSync(keyFile) && readFileSync(keyFile, "utf8") === key) return;
  // Matter's live session reads the file between turns (live.ts); the thread line is for the operator's eyes.
  writeFileSync(STALL_FILE, text);
  writeFileSync(keyFile, key);
  if (client !== null)
    await client.from("agent_messages").insert({
      thread: "matter",
      author_kind: "system",
      author_id: "system",
      author_name: "Matter of Place",
      body: text.slice(0, 20000),
    });
}

if (import.meta.main) {
  // The task's own limit ends only its launcher (P-4660), so the sweep ends itself first; the next sweep ends one that
  // could not (a timer cannot fire inside a blocking call).
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
