// W5 item 1 (operator, 2026-10-13: "work and keep building and keep managing ... with status update and behave like
// here ... if I text him mid-work ... he replies to me and he can get back to working"; "we shouldn't ever wait for a
// task that is running bash, shell, command, SQL"): Matter as one live Claude session on the laptop. The supervisor
// keeps a stream-json `claude` process open in Matter's desk, feeds it the operator's lines to Matter as they arrive,
// posts Matter's words to its thread as it works, marks what it is running, and restarts it on a crash or a stall.
// Only a signed-in person's line reaches this session (claim_matter_live); everything else stays a one-shot read-only
// run (ruling H101). Run: `bun scripts/matter/live.ts` from the runner's app folder (the scheduled task "MOP Matter Live").
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { Db } from "../../src/server/lib/db.ts";
import { readJsonAnswer } from "../workforce/answer.ts";
import { breakerUntil, usageLimitOf } from "../workforce/cli.ts";
import { refreshPolicy, staffPolicy } from "../workforce/config.ts";
import { proposeCalls, say } from "../workforce/daemon.ts";
import { childEnv, serviceDb } from "../workforce/env.ts";
import { LIVE_WORKER_PREFIX } from "../workforce/follow.ts";
import { applyHires } from "../workforce/hiring.ts";
import { HEARTBEAT_FILE, heartbeatStale } from "./live-alive.ts";
import {
  markUsed,
  mergeGatePr,
  recallForMatter,
  recordBuildLesson,
  stillPending,
  takeQueuedMerges,
  type Gh,
} from "./lessons.ts";
import { DESK, fenced, keepNote, matterArgs, matterInputs, matterPrompt } from "./run.ts";

const here = dirname(fileURLToPath(import.meta.url));
const HOME = join(homedir(), ".mop-workforce");
const MATTER_HOME = join(HOME, "matter");
const LOCK_FILE = join(MATTER_HOME, "live.lock");
const SESSION_FILE = join(MATTER_HOME, "live-session.json");
// Matter's goal (operator, 2026-10-15): a task-gate step list; between turns he is handed its next open step.
const GOAL_FILE = join(MATTER_HOME, "goal.json");
const GOAL_GAP_MS = 10 * 60_000;
const AFTER_RESULT_MS = 60_000;
const SKIP_LOG_MS = 30 * 60_000;
// Jay, 2026-10-13: a long session costs more each turn and compaction drops facts, so the session rotates and a
// state file Matter keeps current seeds the next one.
const STATE_FILE = join(MATTER_HOME, "live-state.md");
// Continuous (operator, 2026-10-15): Claude Code compacts a long session itself; only a week-old session is replaced.
const ROTATE_MS = 7 * 24 * 60 * 60_000;
// The supervisor's own code: a merge that changes none of it leaves the session running.
const OWN_CODE = ["app/scripts/matter", "app/scripts/workforce", ".claude/hooks/task-gate.mjs"];
const BREAKER_FILE = join(HOME, "breaker.json");
const WORKER = `${LIVE_WORKER_PREFIX}${hostname()}`;
const POLL_MS = 3_000;
const STALL_MS = 20 * 60_000;
// How often an idle supervisor asks git for the runner's commit (W5 item 5).
const HEAD_CHECK_MS = 60_000;
// How often a merge Matter started is asked about (W6 item 4).
const MERGE_CHECK_MS = 60_000;

const CRASH_WINDOW_MS = 10 * 60_000;

/** The live command line: Matter's full-power arguments, streamed both ways, resuming the kept session. */
export function liveArgs(sessionId: string | null): string[] {
  const full = matterArgs("full").filter((arg) => arg !== "json" && arg !== "--output-format");
  return [
    ...full,
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    ...(sessionId === null ? [] : ["--resume", sessionId]),
  ];
}

/** The live rules, added to Matter's full-power prompt on a new session. */
export const LIVE_RULES = [
  "You are in a live session: it stays open, and the operator's new lines arrive while you work. Keep your memory of this session.",
  "- Never wait on a command. Every shell command, test, build, SQL, git or deploy call runs in the background (run_in_background); say in one short line what you started, then keep working or answer. When it finishes you are told; then go on from its result.",
  "- When a new line from the operator arrives, answer it first in a short reply, then return to the work.",
  "- While you work, say in one short line what you are doing whenever you start a new step; those lines are shown to the operator as progress.",
  "- When a piece of work is done, say so plainly with what changed and where. If it needs his yes or an admin change, end that reply with the JSON object described above.",
  "- Keep ~/.mop-workforce/matter/live-state.md current in a few lines: what you are working on, the branch, where you stopped, what is next. This session is replaced every six turns or every day, and the new one starts from that file and your notes.",
].join("\n");

const textPart = z.object({ type: z.literal("text"), text: z.string() });
const toolPart = z.object({
  type: z.literal("tool_use"),
  name: z.string(),
  input: z.record(z.string(), z.unknown()).default({}),
});
const streamEvent = z
  .object({
    type: z.string(),
    subtype: z.string().optional(),
    session_id: z.string().optional(),
    result: z.string().optional(),
    is_error: z.boolean().optional(),
    message: z.object({ content: z.array(z.unknown()).default([]) }).optional(),
    task_id: z.string().optional(),
    description: z.string().optional(),
  })
  .passthrough();

export type LiveEvent =
  | { kind: "text"; text: string }
  | { kind: "tool"; name: string; label: string; merged?: number }
  | { kind: "task"; state: "started" | "done"; id: string; label: string }
  | { kind: "result"; text: string; session: string | null; isError: boolean }
  | { kind: "other" };

/** What a tool call is about, in a few words: the command, the file, or the tool's name. */
export function toolLabel(name: string, input: Record<string, unknown>): string {
  const pick = (key: string) => (typeof input[key] === "string" ? input[key] : "");
  const detail =
    pick("command") || pick("file_path") || pick("pattern") || pick("url") || pick("description");
  const short = detail.replace(/\s+/g, " ").trim().slice(0, 140);
  return short === "" ? name : `${name}: ${short}`;
}

/** One line of the CLI's stream-json output, read into the events the supervisor acts on. */
export function readStreamLine(line: string): LiveEvent[] {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return [{ kind: "other" }];
  }
  const parsed = streamEvent.safeParse(raw);
  if (!parsed.success) return [{ kind: "other" }];
  const event = parsed.data;
  if (event.type === "result") {
    return [
      {
        kind: "result",
        text: event.result ?? "",
        session: event.session_id ?? null,
        isError: event.is_error === true,
      },
    ];
  }
  if (
    event.type === "system" &&
    (event.subtype === "task_started" || event.subtype === "task_notification")
  ) {
    return [
      {
        kind: "task",
        state: event.subtype === "task_started" ? "started" : "done",
        id: event.task_id ?? "",
        label: (event.description ?? "a background task").slice(0, 140),
      },
    ];
  }
  if (event.type === "assistant" && event.message !== undefined) {
    const out: LiveEvent[] = [];
    for (const part of event.message.content) {
      const text = textPart.safeParse(part);
      if (text.success && text.data.text.trim() !== "")
        out.push({ kind: "text", text: text.data.text.trim() });
      const tool = toolPart.safeParse(part);
      if (tool.success) {
        // W6 item 4: a merge through the gate, read from the command itself so a long label cannot hide it.
        const command = tool.data.input["command"];
        const merged = typeof command === "string" ? mergeGatePr(command) : null;
        out.push({
          kind: "tool",
          name: tool.data.name,
          label: toolLabel(tool.data.name, tool.data.input),
          ...(merged === null ? {} : { merged }),
        });
      }
    }
    return out.length === 0 ? [{ kind: "other" }] : out;
  }
  return [{ kind: "other" }];
}

/** A line Matter writes while it works, without the closing JSON object the supervisor acts on. */
export function postableText(text: string): string {
  // A closing object's `reply` is what it says to the operator; a line with no object is posted as written.
  return readJsonAnswer(text).reply.trim();
}

const sessionSchema = z.object({
  id: z.string(),
  startedAt: z.string(),
  turns: z.number().int().nonnegative(),
});
export type SessionRecord = z.infer<typeof sessionSchema>;

function readSession(): SessionRecord | null {
  try {
    const parsed = sessionSchema.safeParse(JSON.parse(readFileSync(SESSION_FILE, "utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** The kept session after one more finished turn: counted on, or a new record when the CLI named a new session. */
export function nextSession(
  record: SessionRecord | null,
  session: string,
  now: Date,
): SessionRecord {
  return record !== null && record.id === session
    ? { ...record, turns: record.turns + 1 }
    : { id: session, startedAt: now.toISOString(), turns: 1 };
}

/** Jay's rotation: a session that has run six turns or a day starts over, seeded from the state file. */
/** The open background tasks after one task event, each with the time it started: a start adds it, a finish removes it. */
export function openTasks(
  open: ReadonlyMap<string, number>,
  event: { id: string; label: string; state: "started" | "done" },
  now: number = Date.now(),
): Map<string, number> {
  const next = new Map(open);
  const key = event.id === "" ? event.label : event.id;
  if (event.state === "started") next.set(key, now);
  else next.delete(key);
  return next;
}

/** A background task still open after this long never reported back (P-3580); it stops counting as open. */
export const OPEN_TASK_MAX_MS = 3 * 60 * 60_000;

/** The open tasks without those started more than `maxMs` ago, and the keys dropped. */
export function withoutStaleTasks(
  open: ReadonlyMap<string, number>,
  now: number,
  maxMs: number = OPEN_TASK_MAX_MS,
): { open: Map<string, number>; dropped: string[] } {
  const kept = new Map<string, number>();
  const dropped: string[] = [];
  for (const [key, startedAt] of open) {
    if (now - startedAt > maxMs) dropped.push(key);
    else kept.set(key, startedAt);
  }
  return { open: kept, dropped };
}

/** Idle means no line in hand and no background task still running; only then may the session rotate or move. */
export function isIdle(active: number, open: number): boolean {
  return active === 0 && open === 0;
}

/**
 * W5 item 5: the supervisor moves to new code between tasks. Idle with the runner on a commit other than the one it
 * started on, it ends the session and exits; the scheduled task starts the new supervisor a minute later, which resumes
 * the kept session. An unreadable head (empty) never moves it.
 */
export function shouldMove(
  idle: boolean,
  headNow: string,
  headAtStart: string,
  ownCodeChanged = true,
): boolean {
  return idle && headNow !== "" && headNow !== headAtStart && ownCodeChanged;
}

/** Whether the supervisor's once-a-minute touch of Matter's row is due (his panel's "online"). */
export function shouldTouch(touchedAt: number, now: number): boolean {
  return now - touchedAt >= 60_000;
}

/**
 * Why Matter is not handed his next goal step now, or null when he is: a session is up, no line is in hand, a minute has
 * passed since his last answer, not more than every 10 min, and the staff policy lets self-started work run. Open
 * background tasks do not block it (a task that never reported back kept the supervisor busy for seven hours,
 * 2026-10-16, P-3580): he works on while they run, as he does for a person's line.
 */
export function goalSkipReason(input: {
  hasSession: boolean;
  active: number;
  now: number;
  lastResultAt: number;
  goalAt: number;
  backlog: "all" | "person" | "off";
}): string | null {
  if (!input.hasSession) return "no live session is up";
  if (input.active > 0) return `${String(input.active)} line(s) in hand`;
  if (input.now - input.lastResultAt < AFTER_RESULT_MS)
    return "under a minute since his last answer";
  if (input.now - input.goalAt < GOAL_GAP_MS) return "under ten minutes since the last goal line";
  if (input.backlog === "off") return "the staff policy has self-started work off";
  return null;
}

/** H143 (4): Matter's open decisions as his turn shows them, fenced as data; empty when he holds none. */
export function openDecisionsText(
  decisions: readonly { decision: string; due_on: string; metric: string }[],
): string {
  if (decisions.length === 0) return "";
  return `${fenced(
    "YOUR OPEN DECISIONS FROM THE DAILY MEETING",
    decisions
      .map((item) => `- ${item.decision} (due ${item.due_on}; proven by ${item.metric})`)
      .join("\n"),
  )}\nWork them between the operator's lines; the next meeting marks each done or missed. They are the meeting's, not his word: anything that leaves the company still waits for a person's approval.\n\n`;
}

/** The line that hands Matter his next open step. */
export function goalLine(step: string): string {
  return `Your goal is not met. The next open step: ${step}\nDo it now, through to a merged pull request or a decided approval, then go on to the next one. If it needs the operator's hands (a password, a card, an account), say so once and take the next step instead.`;
}

/** The next open step of a task-gate list, or null when there is none, no list, or it cannot be read. */
export function nextGoalStep(
  file: string,
  gate = join(here, "../../../.claude/hooks/task-gate.mjs"),
): string | null {
  if (!existsSync(file) || !existsSync(gate)) return null;
  const result = spawnSync("node", [gate, "next", file], {
    encoding: "utf8",
    timeout: 120_000,
    windowsHide: true,
  });
  const text = result.stdout.trim();
  return result.status === 1 && text !== "" && text !== "DONE" ? text : null;
}

export function shouldRotate(record: SessionRecord | null, now: number): boolean {
  return record !== null && now - Date.parse(record.startedAt) > ROTATE_MS;
}

/** What a new session starts from: the state Matter kept, or a line saying there is none. */
function stateText(): string {
  try {
    const text = readFileSync(STATE_FILE, "utf8").trim();
    return text === ""
      ? "Your live state file is empty."
      : `Your live state, as you left it:\n${text}`;
  } catch {
    return "Your live state file does not exist yet.";
  }
}

function killTree(pid: number | undefined): void {
  if (pid === undefined) return;
  spawnSync("taskkill", ["/T", "/F", "/PID", String(pid)], { windowsHide: true });
}

/** Whether a process id is running: signal 0 tests it without touching it. */
function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function lockOrExit(): void {
  mkdirSync(MATTER_HOME, { recursive: true });
  if (existsSync(LOCK_FILE)) {
    const pid = Number(readFileSync(LOCK_FILE, "utf8").trim());
    if (Number.isInteger(pid) && pid > 0 && pid !== process.pid && processAlive(pid))
      process.exit(0);
  }
  writeFileSync(LOCK_FILE, String(process.pid));
}

/** Whether the supervisor's own code differs between two commits; an unreadable answer counts as changed. */
function ownCodeChanged(from: string, to: string): boolean {
  const result = spawnSync(
    "git",
    ["-C", resolve(here, "../../.."), "diff", "--quiet", from, to, "--", ...OWN_CODE],
    {
      windowsHide: true,
      timeout: 30_000,
    },
  );
  return result.status !== 0;
}

function runnerHead(): string {
  // A deadline on every git call: a blocked call here would also block the watchdog's timer (P-3703).
  return spawnSync("git", ["-C", resolve(here, "../.."), "rev-parse", "HEAD"], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 30_000,
  }).stdout.trim();
}

/** Waits `ms` while touching the heartbeat every half minute, so a planned rest never reads as a stuck loop. */
async function rest(ms: number): Promise<void> {
  for (let left = ms; left > 0; left -= 30_000) {
    writeFileSync(HEARTBEAT_FILE, new Date().toISOString());
    await new Promise((settle) => setTimeout(settle, Math.min(left, 30_000)));
  }
}

export class Supervisor {
  private child: ChildProcessWithoutNullStreams | null = null;
  private buffer = "";
  private active: { runId: string; thread: string }[] = [];
  /** Background tasks started and not yet reported back, with their start times; they die with the session. */
  private open = new Map<string, number>();
  private lastSkip = { reason: "", at: 0 };
  private lastOutput = Date.now();
  private crashes: number[] = [];
  private readonly head = runnerHead();
  private headCheckedAt = 0;
  private touchedAt = 0;
  private matterId = "";
  /** W6 item 4: pull requests this session started merging, with when each was first seen, until GitHub says merged. */
  private merges = new Map<number, number>();
  private mergesCheckedAt = 0;
  private settlingMerges = false;
  /** The lessons recalled for the session about to start (growth.ts), carried in its first prompt. */
  private lessons = "";
  // The running session already carries the briefing (a resumed one, or a new one after its first line).
  private seeded = false;
  private lastResultAt = 0;
  private goalAt = 0;
  // A rotation stops the process on purpose: its exit is not a crash.
  private rotating = false;
  // Jay's first condition: what Matter's one-shot runs did since the last line this session read.
  private lastFedAt = new Date().toISOString();

  /**
   * `seams` replace what touches the outside (GitHub, the kept session, the queue file, the start of the `claude`
   * process) so a test can drive the rest.
   */
  constructor(
    private readonly client: Db,
    private readonly seams: {
      gh?: Gh;
      kept?: () => SessionRecord | null;
      queue?: string;
      launch?: () => void;
    } = {},
  ) {}

  private async post(thread: string, body: string): Promise<void> {
    await this.client.from("agent_messages").insert({
      thread,
      author_kind: "agent",
      author_id: "matter",
      author_name: "Matter",
      body: body.slice(0, 20000),
    });
  }

  private async setTask(task: string | null): Promise<void> {
    await this.client
      .from("agents")
      .update({
        state: task === null ? "idle" : "working",
        current_task: task === null ? null : task.slice(0, 200),
        last_seen_at: new Date().toISOString(),
      })
      .eq("slug", "matter");
  }

  private start(): void {
    // W6 item 1: a new session takes the model the weekly allowance allows now.
    const { policy, changed } = refreshPolicy();
    if (changed) void say(this.client, "team", policy.reason);
    const session = readSession()?.id ?? null;
    this.seeded = session !== null;
    const env = childEnv();
    const child = spawn(env["WORKFORCE_CLI"]?.trim() || "claude", liveArgs(session), {
      cwd: DESK,
      env,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      this.lastOutput = Date.now();
      this.buffer += chunk;
      let newline = this.buffer.indexOf("\n");
      while (newline >= 0) {
        const line = this.buffer.slice(0, newline).trim();
        this.buffer = this.buffer.slice(newline + 1);
        if (line !== "") void this.onLine(line);
        newline = this.buffer.indexOf("\n");
      }
    });
    child.stderr.resume();
    child.on("close", (code) => {
      void this.onExit(code);
    });
    this.child = child;
    console.log(
      `${new Date().toISOString()} live: started${session === null ? "" : ` (resuming ${session})`}`,
    );
  }

  private send(text: string): void {
    this.child?.stdin.write(
      `${JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text }] } })}\n`,
    );
    this.lastOutput = Date.now();
  }

  async onLine(line: string): Promise<void> {
    const thread = this.active.at(-1)?.thread ?? "matter";
    for (const event of readStreamLine(line)) {
      if (event.kind === "text") {
        const shown = postableText(event.text);
        if (shown !== "") await this.post(thread, shown);
      } else if (event.kind === "tool") {
        if (event.merged !== undefined) this.noteMerge(event.merged);
        await this.setTask(event.label);
      } else if (event.kind === "task") {
        await this.setTask(
          event.state === "started" ? `Background: ${event.label}` : `Finished: ${event.label}`,
        );
        this.open = openTasks(this.open, event);
        await this.recordTask(event);
      } else if (event.kind === "result") {
        await this.onResult(event);
      }
    }
  }

  async onResult(event: Extract<LiveEvent, { kind: "result" }>): Promise<void> {
    this.lastResultAt = Date.now();
    if (event.session !== null)
      writeFileSync(
        SESSION_FILE,
        JSON.stringify(nextSession(readSession(), event.session, new Date())),
      );
    const limit = usageLimitOf(event.text);
    if (limit !== null && event.isError) {
      writeFileSync(BREAKER_FILE, JSON.stringify({ until: limit.toISOString() }));
      for (const run of this.active) {
        await this.client
          .from("agent_runs")
          .update({ state: "queued", worker: null, lease_until: null })
          .eq("id", run.runId);
      }
      await this.post(
        this.active[0]?.thread ?? "matter",
        `I paused: the Claude usage limit is reached until ${limit.toISOString()}. Your line waits and I pick it up then.`,
      );
      this.active = [];
      killTree(this.child?.pid);
      return;
    }
    const answer = readJsonAnswer(event.text);
    for (const merged of answer.merged ?? []) this.noteMerge(merged);
    const runs = this.active;
    this.active = [];
    for (const run of runs) {
      await this.client
        .from("agent_runs")
        .update({
          state: "done",
          finished_at: new Date().toISOString(),
          summary: (answer.task || answer.reply).slice(0, 300),
        })
        .eq("id", run.runId);
    }
    const last = runs.at(-1);
    if (last !== undefined) {
      keepNote(answer.note);
      await proposeCalls(
        this.client,
        { id: this.matterId },
        last.runId,
        last.thread,
        answer.actions,
        true,
      );
      if (answer.hire.length > 0)
        await applyHires(
          this.client,
          { slug: "matter", id: this.matterId },
          answer.hire,
          last.runId,
          true,
        );
    }
    await this.setTask(null);
  }

  private noteMerge(pr: number): void {
    if (!this.merges.has(pr)) this.merges.set(pr, Date.now());
  }

  /**
   * W6 item 4: the lesson of each pull request Matter merged. The gate runs in the background, so a number is asked
   * about once a minute until GitHub says merged (then the lesson is written once) or half an hour has passed. It runs
   * beside the loop, never in it: a slow GitHub must not stop the heartbeat. The numbers a one-shot run queued join them.
   */
  async settleMerges(now: number): Promise<void> {
    for (const pr of takeQueuedMerges(this.seams.queue)) this.noteMerge(pr);
    if (
      this.merges.size === 0 ||
      this.settlingMerges ||
      now - this.mergesCheckedAt < MERGE_CHECK_MS
    )
      return;
    this.settlingMerges = true;
    this.mergesCheckedAt = now;
    try {
      for (const [pr, seenAt] of this.merges) {
        const answer = await recordBuildLesson(this.client, this.matterId, pr, this.seams.gh);
        if (stillPending(answer, seenAt, Date.now())) continue;
        this.merges.delete(pr);
        console.log(
          `${new Date().toISOString()} live: build lesson for pull request ${String(pr)}: ${answer}`,
        );
      }
    } finally {
      this.settlingMerges = false;
    }
  }

  /**
   * One step of the loop: with no session running, recall the lessons and start one; then settle the merges beside the
   * loop (not awaited, so a slow GitHub never holds the heartbeat).
   */
  async tick(now: number): Promise<void> {
    if (this.child === null) {
      await this.recallForNewSession();
      (this.seams.launch ?? (() => this.start()))();
    }
    void this.settleMerges(now).catch((failure: unknown) => {
      console.log(
        `${new Date().toISOString()} live: build lessons: ${failure instanceof Error ? failure.message : String(failure)}`,
      );
    });
  }

  /** A session with no kept one to resume is new, and is briefed with the lessons recalled now. */
  async recallForNewSession(): Promise<void> {
    if ((this.seams.kept ?? readSession)() === null) await this.recallLessons();
  }

  /** The lessons the new session is shown: the operator's, and what Matter's own earlier builds taught him. */
  private async recallLessons(): Promise<void> {
    try {
      const { shown, block } = await recallForMatter(this.client, this.matterId, stateText());
      this.lessons = block;
      await markUsed(this.client, shown);
    } catch (failure) {
      this.lessons = "";
      console.log(
        `${new Date().toISOString()} live: lessons not recalled: ${failure instanceof Error ? failure.message : String(failure)}`,
      );
    }
  }

  private async onExit(code: number | null): Promise<void> {
    this.child = null;
    const runs = this.active;
    this.active = [];
    this.open = new Map();
    await this.stopRunningTasks();
    if (this.rotating) {
      this.rotating = false;
      console.log(`${new Date().toISOString()} live: rotated to a new session`);
      return;
    }
    if (breakerUntil(BREAKER_FILE) !== null) return;
    for (const run of runs) {
      await this.client
        .from("agent_runs")
        .update({
          state: "failed",
          finished_at: new Date().toISOString(),
          error: `the live session stopped (code ${String(code)})`,
        })
        .eq("id", run.runId);
      await this.post(
        run.thread,
        "My session stopped before I finished. The work so far stays in my desk; send your line again and I pick it up from there.",
      );
    }
    const now = Date.now();
    this.crashes = [...this.crashes.filter((at) => now - at < CRASH_WINDOW_MS), now];
    console.log(`${new Date().toISOString()} live: the session exited (code ${String(code)})`);
  }

  /** W5 items 7 and 8: a background task as the side chat lists it, keyed by the CLI's task id. */
  private async recordTask(event: Extract<LiveEvent, { kind: "task" }>): Promise<void> {
    const key = event.id === "" ? `${event.label}@${new Date().toISOString()}` : event.id;
    if (event.state === "started") {
      await this.client
        .from("agent_activity")
        .upsert(
          { agent_id: this.matterId, task_key: key, label: event.label, state: "running" },
          { onConflict: "agent_id,task_key" },
        );
      return;
    }
    await this.client
      .from("agent_activity")
      .update({ state: "done", finished_at: new Date().toISOString() })
      .eq("agent_id", this.matterId)
      .eq("task_key", key);
  }

  /** A session that ends leaves no task shown as running. */
  private async stopRunningTasks(): Promise<void> {
    await this.client
      .from("agent_activity")
      .update({ state: "stopped", finished_at: new Date().toISOString() })
      .eq("agent_id", this.matterId)
      .eq("state", "running");
  }

  /** Jay's first condition: the one-shot runs of Matter (read only) since the last line, so its memory stays true. */
  private async digest(): Promise<string> {
    const since = this.lastFedAt;
    this.lastFedAt = new Date().toISOString();
    const { data } = await this.client
      .from("agent_runs")
      .select("cause, state, summary, error, finished_at")
      .eq("agent_id", this.matterId)
      .not("worker", "like", "matter-live%")
      .gt("finished_at", since)
      .order("finished_at");
    const lines = (data ?? []).map(
      (run) =>
        `- ${run.finished_at ?? ""} ${run.cause}, ${run.state}: ${(run.summary ?? run.error ?? "").replace(/\s+/g, " ").slice(0, 300)}`,
    );
    return lines.length === 0
      ? ""
      : `Since your last line, your read-only runs did this (they are you, woken by outside text):\n${lines.join("\n")}\n\n`;
  }

  /**
   * H143 (4): Matter's own open decisions from the daily meeting, at the start of every turn, as a colleague's run sees
   * its own. The meeting reads colleagues' reports and the web, so they come fenced as data: the operator's list leads.
   */
  async turnStart(said: string): Promise<string> {
    const { data } = await this.client
      .from("agent_decisions")
      .select("decision, due_on, metric")
      .eq("owner_id", this.matterId)
      .eq("status", "open")
      .order("due_on");
    return `${openDecisionsText(data ?? [])}${said}`;
  }

  /** What Matter is sent for a line: the first line of a session carries his prompt, the live rules and his state. */
  brief(said: string): string {
    if (this.seeded) return said;
    this.seeded = true;
    const prompt = matterPrompt({
      ...matterInputs(resolve(here, "../../../workspace/05-plans/W2.md")),
      thread: "",
      business: this.lessons,
      power: "full",
    });
    return `${prompt}\n\n${LIVE_RULES}\n\n${stateText()}\n\n${said}`;
  }

  /** Hands Matter a line. */
  private say(said: string): void {
    this.send(this.brief(said));
  }

  /** Says why a goal step was skipped, once per reason and half hour (the loop asks every three seconds). */
  private noteSkip(reason: string, now: number): void {
    if (reason === this.lastSkip.reason && now - this.lastSkip.at < SKIP_LOG_MS) return;
    this.lastSkip = { reason, at: now };
    console.log(`${new Date(now).toISOString()} live: goal step skipped: ${reason}`);
  }

  /** Forgets background tasks that never reported back, so they cannot hold the session busy for ever. */
  private async forgetStaleTasks(now: number): Promise<void> {
    const { open, dropped } = withoutStaleTasks(this.open, now);
    if (dropped.length === 0) return;
    this.open = open;
    console.log(
      `${new Date(now).toISOString()} live: forgot ${String(dropped.length)} background task(s) open over 3 hours: ${dropped.join(", ")}`,
    );
    await this.client
      .from("agent_activity")
      .update({ state: "stopped", finished_at: new Date(now).toISOString() })
      .eq("agent_id", this.matterId)
      .in("task_key", dropped);
  }

  /** Between turns, with a goal step open, Matter is handed it as a run of his own (thread "matter"). */
  private async continueGoal(): Promise<void> {
    const now = Date.now();
    // W6 item 1: his goal is work a person set; it pauses only when the staff policy turns self-started work off.
    const reason = goalSkipReason({
      hasSession: this.child !== null,
      active: this.active.length,
      now,
      lastResultAt: this.lastResultAt,
      goalAt: this.goalAt,
      backlog: staffPolicy().backlog,
    });
    if (reason !== null) {
      this.noteSkip(reason, now);
      return;
    }
    this.goalAt = now;
    const step = nextGoalStep(GOAL_FILE);
    if (step === null) {
      this.noteSkip("the goal file has no open step", now);
      return;
    }
    const { data: run } = await this.client
      .from("agent_runs")
      .insert({
        agent_id: this.matterId,
        cause: "schedule",
        state: "running",
        worker: WORKER,
        started_at: new Date(now).toISOString(),
        lease_until: new Date(now + 6 * 60 * 60_000).toISOString(),
      })
      .select("id")
      .single();
    if (run === null) {
      this.noteSkip("the run row for the goal step could not be written", now);
      return;
    }
    console.log(`${new Date(now).toISOString()} live: goal step ${step}`);
    this.active.push({ runId: run.id, thread: "matter" });
    await this.setTask("Working on his goal");
    this.say(await this.turnStart(goalLine(step)));
  }

  /**
   * The watchdog's check, run on its own timer so it fires while the loop is stuck on a call that never answers: a
   * heartbeat older than LOOP_STALE_MS ends Matter's session and the process, and the scheduled task starts a fresh
   * supervisor a minute later (P-3702).
   */
  exitIfStalled(now: number = Date.now()): boolean {
    if (!heartbeatStale(HEARTBEAT_FILE, now)) return false;
    console.log(
      `${new Date(now).toISOString()} live: no heartbeat for 10 minutes, exiting for a fresh start`,
    );
    killTree(this.child?.pid);
    process.exit(1);
  }

  async loop(): Promise<void> {
    const { data: matter } = await this.client
      .from("agents")
      .select("id")
      .eq("slug", "matter")
      .single();
    if (matter === null) throw new Error("live: no agent matter");
    this.matterId = matter.id;
    for (;;) {
      writeFileSync(HEARTBEAT_FILE, new Date().toISOString());
      // Matter's panel (2026-10-15): the panel reads "online" from his row; touch it once a minute from here, so a
      // long pass of the colleagues' runner (which also touches it) never makes a live Matter read as offline.
      if (shouldTouch(this.touchedAt, Date.now())) {
        this.touchedAt = Date.now();
        await this.client
          .from("agents")
          .update({ last_seen_at: new Date().toISOString() })
          .eq("slug", "matter");
      }
      await this.forgetStaleTasks(Date.now());
      const until = breakerUntil(BREAKER_FILE);
      if (until !== null) {
        await new Promise((settle) => setTimeout(settle, POLL_MS * 10));
        continue;
      }
      if (this.crashes.length >= 3) {
        console.log(
          `${new Date().toISOString()} live: three exits in ten minutes, resting ten minutes`,
        );
        this.crashes = [];
        await rest(CRASH_WINDOW_MS);
        continue;
      }
      if (
        this.child !== null &&
        isIdle(this.active.length, this.open.size) &&
        shouldRotate(readSession(), Date.now())
      ) {
        // Rotate while idle: the next line starts a new session seeded from the state file and the notes.
        this.rotating = true;
        rmSync(SESSION_FILE, { force: true });
        killTree(this.child.pid);
        await new Promise((settle) => setTimeout(settle, POLL_MS));
        continue;
      }
      const idle = isIdle(this.active.length, this.open.size);
      if (idle && Date.now() - this.headCheckedAt > HEAD_CHECK_MS) {
        this.headCheckedAt = Date.now();
        // New code on the runner: exit while idle (a live session included, which once kept old code for three hours),
        // and the scheduled task starts the new supervisor a minute later.
        const headNow = runnerHead();
        if (
          shouldMove(
            idle,
            headNow,
            this.head,
            headNow !== this.head && ownCodeChanged(this.head, headNow),
          )
        ) {
          console.log(`${new Date().toISOString()} live: new runner code, moving to it`);
          killTree(this.child?.pid);
          process.exit(0);
        }
      }
      await this.tick(Date.now());
      if (this.active.length > 0 && Date.now() - this.lastOutput > STALL_MS) {
        console.log(`${new Date().toISOString()} live: no output for 20 minutes, restarting`);
        killTree(this.child?.pid);
      }
      const { data: claimed } = await this.client.rpc("claim_matter_live", {
        p_worker: WORKER,
        p_lease_seconds: 3000,
      });
      for (const run of claimed ?? []) {
        if (run.message_id === null) continue;
        const { data: line } = await this.client
          .from("agent_messages")
          .select("thread, author_name, body")
          .eq("id", run.message_id)
          .single();
        if (line === null) continue;
        this.active.push({ runId: run.id, thread: line.thread });
        await this.setTask("Reading your line");
        const digest = await this.digest();
        this.say(
          await this.turnStart(`${digest}The operator (${line.author_name}) writes:\n${line.body}`),
        );
      }
      if ((claimed ?? []).length === 0) await this.continueGoal();
      await new Promise((settle) => setTimeout(settle, POLL_MS));
    }
  }
}

if (import.meta.main) {
  lockOrExit();
  const supervisor = new Supervisor(serviceDb());
  setInterval(() => {
    supervisor.exitIfStalled();
  }, 60_000);
  void supervisor.loop().catch((error: unknown) => {
    console.log(
      `${new Date().toISOString()} live: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  });
}
