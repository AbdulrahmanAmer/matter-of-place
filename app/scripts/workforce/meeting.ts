// W2 step 7 (contract 9 to 14): the team's daily meeting, written, templated and deciding. The "MOP Meeting" scheduled
// task runs it at 17:45 local time on the operator's laptop (Cairo, so 18:00 follows Egypt's clock changes):
//   bun scripts/workforce/meeting.ts          meet once today (a second start the same day does nothing)
//   bun scripts/workforce/meeting.ts --dry    print what it would post, write nothing
//   bun scripts/workforce/meeting.ts --prompts  build each step's prompt and log its size; no Claude, nothing written
// W8 0j round 3: each step logs its prompt's size, its duration and how it ended; a step that stops is said in the team
// thread, and the next start the same day runs only the steps that did not finish (meeting-<date>.steps.json).
// 1. The Analyst posts the scorecard (eight numbers against last week, read by code) with at most three observations,
//    and the day's competitor changes; what it learned goes to the knowledge base.
// 2. Each colleague posts three lines: done (with one number), next, blocked on. No replies between agents.
// 3. Matter closes yesterday's decisions as done or missed, writes at most five new ones (owner, due date, the number
//    that proves it), may hire when a role is overloaded, says which upgrade comes next when a gauge nears its limit,
//    and sends the operator a ten-line digest in his side chat.
// 4. (H143) Matter is shown what each owner can do and the rulings that limit it; a decision missed twice in a row is
//    retired or reshaped, never set a third time; each colleague with an open decision is woken on it at once.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { readOnly, toolkitFor, toolkitWords } from "../../src/domain/toolkits.ts";
import {
  agentToolLabels,
  agentTools,
  hireInputSchema,
  type AgentTool,
} from "../../src/domain/workforce.ts";
import type { Db } from "../../src/server/lib/db.ts";
import { askMatter, fenced, matterInputs, runTimeoutMs } from "../matter/run.ts";
import { staffCharterFrom } from "./charter.ts";
import { breakerUntil, isolatedArgs, runClaude, UsageLimitError, type CliUsage } from "./cli.ts";
import { staffPolicy } from "./config.ts";
import { childEnv, serviceDb as client } from "./env.ts";
import { costMicroUsd, inputTokens } from "./growth.ts";
import { applyHires } from "./hiring.ts";
import { knowledgeBlock, remember } from "./knowledge.ts";
import { scorecard, scorecardText } from "./scorecard.ts";
import { underCeiling } from "./usage-policy.ts";

const HOME = join(homedir(), ".mop-workforce");
const PLAN = resolve(dirname(fileURLToPath(import.meta.url)), "../../../workspace/05-plans/W2.md");
const models: Record<string, string> = {
  opus: "claude-opus-5-5",
  sonnet: "claude-sonnet-5-5",
  haiku: "claude-haiku-5-5",
};
const SYSTEM = "Matter of Place";

const analystAnswer = z.object({
  observations: z.array(z.string()).default([]),
  competitors: z.string().default(""),
  knowledge: z.array(z.object({ subject: z.string(), text: z.string() })).default([]),
});
const lineAnswer = z.object({
  done: z.string().default(""),
  next: z.string().default(""),
  blocked: z.string().default(""),
});
export const matterAnswer = z.object({
  closed: z.array(z.object({ id: z.string(), status: z.enum(["done", "missed"]) })).default([]),
  decisions: z
    .array(
      z.object({
        owner: z.string(),
        decision: z.string().min(3).max(500),
        due_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        metric: z.string().min(1).max(200),
      }),
    )
    .default([]),
  // H143 (3): a decision missed twice in a row is retired with a reason, or reshaped into a new one. The reason is
  // lenient: one long or missing reason must not turn the whole answer into the defaults ("No new decision.")
  retired: z
    .array(
      z.object({
        owner: z.string(),
        metric: z.string(),
        reason: z
          .string()
          .catch("no reason given")
          .transform((text) => text.slice(0, 300)),
      }),
    )
    .default([]),
  digest: z.string().default(""),
  knowledge: z.array(z.object({ subject: z.string(), text: z.string() })).default([]),
  hire: z.array(hireInputSchema).default([]),
});

/** The JSON object at the end of a model's answer, or the schema's defaults when there is none. */
export function lastJson<T>(text: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>): T {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const parsed = schema.safeParse(
      (() => {
        try {
          return JSON.parse(text.slice(start, end + 1)) as unknown;
        } catch {
          return undefined;
        }
      })(),
    );
    if (parsed.success) return parsed.data;
  }
  return schema.parse({});
}

/** At most five decisions, each with an owner on the team and a due date not before today. */
export function keptDecisions<T extends { owner: string; due_on: string }>(
  decisions: readonly T[],
  slugs: readonly string[],
  today: string,
): T[] {
  return decisions.filter((item) => slugs.includes(item.owner) && item.due_on >= today).slice(0, 5);
}

/** A decision's proving number as the meeting compares it: lower case, letters and digits, single spaces. */
export function sameMetric(metric: string): string {
  return metric
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const repeatKey = (ownerId: string, metric: string) => `${ownerId} ${sameMetric(metric)}`;

export interface MissStreak {
  owner_id: string;
  metric: string;
  decision: string;
  count: number;
  /** The day its last miss was closed (YYYY-MM-DD), or "" when that row was never checked. */
  checked_on: string;
}

/**
 * H143 (3): how many times in a row each owner's decision with the same number was last missed, from the closed
 * decisions newest first. A decision done ends the streak; only streaks of one or more are kept.
 */
export function missStreaks(
  closed: readonly {
    owner_id: string;
    metric: string;
    decision: string;
    status: string;
    checked_at?: string | null | undefined;
  }[],
): Map<string, MissStreak> {
  const streaks = new Map<string, MissStreak>();
  const ended = new Set<string>();
  for (const row of closed) {
    const key = repeatKey(row.owner_id, row.metric);
    if (ended.has(key)) continue;
    if (row.status !== "missed") {
      ended.add(key);
      continue;
    }
    const streak = streaks.get(key);
    if (streak === undefined)
      streaks.set(key, {
        owner_id: row.owner_id,
        metric: row.metric,
        decision: row.decision,
        count: 1,
        checked_on: row.checked_at?.slice(0, 10) ?? "",
      });
    else streak.count += 1;
  }
  return streaks;
}

/**
 * W8 0j round 3: the streaks Matter's prompt shows. Every streak of two or more, which the runner refuses a third time
 * (H143 (3)); a single miss only from the newest day decisions were closed. An older single miss was not set again
 * since, so it repeats nothing, and setting it again would only be its second (10-27: 15 of 25 streaks, 4,910 characters).
 */
export function shownStreaks(streaks: ReadonlyMap<string, MissStreak>): MissStreak[] {
  const all = [...streaks.values()];
  const newest = all.reduce(
    (day, streak) => (streak.checked_on > day ? streak.checked_on : day),
    "",
  );
  return all.filter(
    (streak) => streak.count >= 2 || (streak.checked_on !== "" && streak.checked_on === newest),
  );
}

/** H143 (3): a decision for an owner and a number already missed twice in a row is refused, never set a third time. */
export function refusedRepeats<T extends { owner: string; metric: string }>(
  decisions: readonly T[],
  streaks: ReadonlyMap<string, MissStreak>,
  idOf: ReadonlyMap<string, string>,
): { kept: T[]; refused: T[] } {
  const twice = (item: T) =>
    (streaks.get(repeatKey(idOf.get(item.owner) ?? "", item.metric))?.count ?? 0) >= 2;
  return {
    kept: decisions.filter((item) => !twice(item)),
    refused: decisions.filter(twice),
  };
}

/**
 * H143 (2): the standing rulings that limit what a decision may ask. The meeting is shown them every day, so it never
 * sets work a ruling forbids (Matter's finding of 2026-10-27: the Concierge was told to contact Fairfield).
 */
export const STANDING_RULINGS = [
  "H134: the Fairfield submission (2400 Azure Pl, Fairfield, CA) is our own test record. No reply, no email and no contact of any kind go to its owner or its agent; it is material to build and test on, nothing more.",
  "S48 and H134: nothing is published to Instagram, X or LinkedIn until those accounts are connected, and for the first 60 days every post, reply or email that leaves the company waits for a person's approval in Approvals.",
  "H143: a colleague's decision run reads and proposes; it writes no file, renders nothing and sends nothing.",
];

/** H143 (2): a tool in the words of a decision run, which no person started: its hires and admin calls wait in Approvals. */
const decisionToolLabels: Partial<Record<AgentTool, string>> = {
  hire: "Proposes a hire, which waits in Approvals for a person",
  admin_call: "Proposes admin changes on its own routes, which wait in Approvals for a person",
};

/**
 * H143 (2): what each owner can do on the run its decisions wake, in the Office's words: a colleague's toolkit as a run
 * no person started holds it (`readOnly`), with the proposals its tools let it make; Matter's live session holds the
 * operator's tools. W8 0j round 3: the words every colleague's run shares are said once, above the owners' own.
 */
export function decisionToolkits(
  team: readonly { slug: string; name: string; tools: readonly string[] }[],
): string {
  const words = new Map(
    team
      .filter((agent) => agent.slug !== "matter")
      .map((agent) => [
        agent.slug,
        [
          ...toolkitWords(readOnly(toolkitFor(agent.slug)), agent.tools),
          ...agentTools
            // toolkitWords already says the web search
            .filter((tool) => agent.tools.includes(tool) && tool !== "research")
            .map((tool) => `${decisionToolLabels[tool] ?? agentToolLabels[tool]}.`),
        ],
      ]),
  );
  const lists = [...words.values()];
  const shared =
    lists.length < 2
      ? []
      : (lists[0] ?? []).filter((sentence) => lists.every((list) => list.includes(sentence)));
  return [
    shared.length === 0 ? "" : `- Every colleague's run: ${shared.join(" ")}`,
    ...team.map((agent) =>
      agent.slug === "matter"
        ? "- @matter: its live session holds the operator's tools on the laptop (code, the admin, renders) and works the operator's list first. Give it only work that needs a write, a render or the admin, which no colleague's run can do; it takes a decision up only with the operator's yes."
        : `- @${agent.slug} (${agent.name}): ${
            (words.get(agent.slug) ?? [])
              .filter((sentence) => !shared.includes(sentence))
              .join(" ") || "nothing beyond that."
          }`,
    ),
  ]
    .filter((line) => line !== "")
    .join("\n");
}

/** H143 (2): the parts of Matter's meeting prompt that bound every decision: the owners' toolkits, the rulings, the rule. */
export function decisionRules(
  team: readonly { slug: string; name: string; tools: readonly string[] }[],
): string[] {
  return [
    `What each owner can do on the run its decisions wake (a colleague's run starts as soon as the meeting ends):\n${decisionToolkits(team)}`,
    `Standing rulings that limit every decision:\n${STANDING_RULINGS.map((line) => `- ${line}`).join("\n")}`,
    "Set a decision only if its owner can do it with what is listed above before its due date. Work that needs a file written, a render, the admin or anything sent is set as a proposal its owner drafts for a person, or given to @matter. Never set a decision a standing ruling forbids.",
  ];
}

/**
 * What Matter's answer does to the decisions: the open ones it closes (only real open ids), and the new ones it keeps.
 * H143 (3): today's closings count first, so a decision missed for the second time today is refused at once.
 */
export function settleDecisions<
  O extends { id: string; owner_id: string; decision: string; metric: string },
  D extends { owner: string; due_on: string; metric: string },
>(
  decided: {
    closed: readonly { id: string; status: "done" | "missed" }[];
    decisions: readonly D[];
  },
  open: readonly O[],
  closed: readonly { owner_id: string; decision: string; metric: string; status: string }[],
  idOf: ReadonlyMap<string, string>,
  handles: readonly string[],
  today: string,
): { closings: (O & { status: "done" | "missed" })[]; kept: D[]; refused: D[] } {
  const closings = decided.closed.flatMap((item) => {
    const row = open.find((candidate) => candidate.id === item.id);
    return row === undefined ? [] : [{ ...row, status: item.status }];
  });
  return {
    closings,
    ...refusedRepeats(
      keptDecisions(decided.decisions, handles, today),
      missStreaks([...closings, ...closed]),
      idOf,
    ),
  };
}

/**
 * H143 (1): the decisions each owner is woken on after the meeting: the open ones it did not close today, and the new
 * ones only when they were recorded (a decision not in the table is said in the team line and wakes nothing).
 */
export function stillOpenDecisions<
  O extends { id: string; owner_id: string },
  D extends { owner: string },
>(
  open: readonly O[],
  closings: readonly { id: string }[],
  kept: readonly D[],
  recorded: boolean,
  idOf: (owner: string) => string,
): (O | (D & { owner_id: string }))[] {
  const closedIds = new Set(closings.map((item) => item.id));
  return [
    ...open.filter((row) => !closedIds.has(row.id)),
    ...(recorded ? kept.map((item) => ({ ...item, owner_id: idOf(item.owner) })) : []),
  ];
}

/**
 * H143 (3): the closed decisions, newest first, so a decision missed twice in a row is seen and refused. A row closed
 * with no `checked_at` (by hand, or by older code) sorts last: Postgres puts nulls first in a descending order.
 */
export async function closedDecisions(db: Db) {
  const { data } = await db
    .from("agent_decisions")
    .select("owner_id, decision, metric, status, checked_at")
    .in("status", ["done", "missed"])
    .order("checked_at", { ascending: false, nullsFirst: false })
    .limit(300);
  return data ?? [];
}

/** The meeting's closing line in the team thread: what closed, what was decided, refused, retired and queued. */
export function decisionsPost(input: {
  today: string;
  closings: readonly { status: string }[];
  kept: readonly { owner: string; decision: string; due_on: string; metric: string }[];
  refused: readonly { owner: string; metric: string }[];
  retired: readonly { owner: string; metric: string; reason: string }[];
  recorded: boolean;
  woken: { queued: readonly string[]; failed: readonly string[] };
}): string {
  const { today, closings, kept, refused, retired, recorded, woken } = input;
  const closedLine =
    closings.length === 0 ? "" : `Yesterday: ${closings.map((item) => item.status).join(", ")}.\n`;
  return [
    `${closedLine}Decisions for ${today}:\n${kept.length === 0 ? "No new decision." : kept.map((item, index) => `${String(index + 1)}. @${item.owner}: ${item.decision} (due ${item.due_on}; proven by ${item.metric})`).join("\n")}`,
    recorded ? "" : "The new decisions could not be recorded; a person looks at the database.",
    ...refused.map(
      (item) =>
        `Refused: @${item.owner}, proven by ${item.metric}, was missed twice in a row; it is retired or reshaped, never set a third time (H143).`,
    ),
    ...retired.map((item) => `Retired: @${item.owner}, proven by ${item.metric}: ${item.reason}`),
    woken.queued.length === 0
      ? ""
      : `Each owner's decisions are in its own thread, and its run on them is queued: ${woken.queued.map((slug) => `@${slug}`).join(", ")}.`,
    woken.failed.length === 0
      ? ""
      : `Not queued, the line or the run could not be written: ${woken.failed.map((slug) => `@${slug}`).join(", ")}.`,
  ]
    .filter((part) => part !== "")
    .join("\n");
}

/** The line in an owner's own thread that names its open decisions and wakes its run on them (H143 (1)). */
export function decisionLine(
  today: string,
  decisions: readonly { decision: string; due_on: string; metric: string }[],
): string {
  return [
    `Your open decisions after the meeting of ${today}:`,
    ...decisions.map(
      (item, index) =>
        `${String(index + 1)}. ${item.decision} (due ${item.due_on}; proven by ${item.metric})`,
    ),
    "Work them now with what this run holds: you read and propose, you write no file and render nothing. Reply here with what you did and the number. What needs a file, a render or a send goes as a proposal for a person; what you cannot do, say plainly and why.",
  ].join("\n");
}

/**
 * Owner ruling 2026-10-26 point 4 (H143 (1)): the meeting's decisions are worked between meetings. Each colleague that
 * holds an open decision, Matter excepted (its live session is shown its own), gets one line from Matter in its own
 * thread naming them, and one run woken by that line. A line from Matter is no person's (`startedFromInside`), so the
 * run holds its toolkit's reads only. A line or a run that cannot be written is said in the result, never dropped.
 */
export async function queueDecisionRuns(
  db: Db,
  team: readonly { id: string; slug: string }[],
  open: readonly { owner_id: string; decision: string; due_on: string; metric: string }[],
  today: string,
): Promise<{ queued: string[]; failed: string[] }> {
  const queued: string[] = [];
  const failed: string[] = [];
  for (const agent of team) {
    if (agent.slug === "matter") continue;
    const mine = open.filter((item) => item.owner_id === agent.id);
    if (mine.length === 0) continue;
    const { data: line, error } = await db
      .from("agent_messages")
      .insert({
        thread: agent.slug,
        author_kind: "agent",
        author_id: "matter",
        author_name: "Matter",
        body: decisionLine(today, mine),
      })
      .select("id")
      .single();
    if (error !== null) {
      failed.push(agent.slug);
      continue;
    }
    const { error: runError } = await db
      .from("agent_runs")
      .insert({ agent_id: agent.id, cause: "message", message_id: line.id });
    (runError === null ? queued : failed).push(agent.slug);
  }
  return { queued, failed };
}

/** Today's date where the operator is (Cairo). */
export function cairoDate(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(now);
}

/**
 * The meeting's command line (W8 fourth review): shut off from the operator's settings; the analyst keeps web search
 * and nothing else, every other voice no tool at all.
 */
export function meetingArgs(model: string, research: boolean): string[] {
  return [
    "-p",
    "--model",
    models[underCeiling(model, staffPolicy().colleagueCeiling)] ?? "claude-sonnet-5-5",
    "--output-format",
    "json",
    ...isolatedArgs(HOME, research ? "WebSearch" : ""),
  ];
}

/**
 * W8 0j round 3: each step's limit, sized from what the meetings measured. Eleven meetings (2026-10-12 to 10-26) ran
 * whole, scorecard, every colleague's lines and the decisions, in 1.8 to 6.2 minutes from start to marker. On 10-27 one
 * colleague's three lines ran past the old 8 minutes on a prompt PR 502 did not change: a step that long is stuck.
 * The worst case, every step just inside its limit with a full team (TEAM_CEILING), is 10 + 10 x 5 + 15 = 75 minutes,
 * inside the 100 minutes the "MOP Meeting" task allows a start (install.ps1, $auditSettings).
 */
export const STEP_LIMIT_MS = {
  // the analyst searches the web, the slowest voice of the meeting
  scorecard: 10 * 60_000,
  // three lines, no tool, one turn
  lines: 5 * 60_000,
  // Matter's decisions keep its read run's own limit (scripts/matter/run.ts)
  decisions: runTimeoutMs("read"),
};

/** W8 0j round 3: the meeting log's line for one step: which, its prompt's size, how long it took, how it ended. */
function stepLine(at: Date, step: string, chars: number, ms: number, ending: string): string {
  return `${at.toISOString()} meeting step ${step}: prompt ${String(chars)} characters, ${String(Math.round(ms / 1000))} s, ${ending}`;
}

/**
 * Runs one step's call and logs its line, answered or stopped. A step that stops is said in the team thread
 * (`stoppedPost`), and its failure goes on to the caller, which ends the meeting there.
 */
export async function meetingStep<T>(
  input: { db: Db; dry: boolean; step: string; prompt: string; again: boolean },
  call: () => Promise<T>,
  log: (line: string) => void = console.log,
  clock: () => number = Date.now,
): Promise<T> {
  const start = clock();
  const line = (ending: string) =>
    stepLine(new Date(start), input.step, input.prompt.length, clock() - start, ending);
  try {
    const answer = await call();
    log(line("answered"));
    return answer;
  } catch (failure) {
    const reason = failure instanceof Error ? failure.message : String(failure);
    log(line(`stopped: ${reason}`));
    await post(
      input.db,
      input.dry,
      "team",
      { slug: "system", name: SYSTEM, kind: "system" },
      stoppedPost(input.step, reason, input.again),
    );
    throw failure;
  }
}

/**
 * The last hour of the day the "MOP Meeting" task starts (install.ps1: daily at 17:45, again every hour until 21:45),
 * so a meeting that started before it has another start today.
 */
const LAST_START_HOUR = 21;
const OPERATOR_ZONE = "Africa/Cairo";

/** Whether a meeting that started at `startedAt` has another start today, Cairo time. */
export function startsLeftToday(startedAt: Date): boolean {
  const hour = new Intl.DateTimeFormat("en-GB", {
    timeZone: OPERATOR_ZONE,
    hour: "2-digit",
    hourCycle: "h23",
  }).format(startedAt);
  return Number(hour) < LAST_START_HOUR;
}

/** W8 0j round 3: the team thread's line when a step stops: which step, that nothing was set, and what comes next. */
export function stoppedPost(step: string, reason: string, again: boolean): string {
  return [
    `The meeting stopped at ${step}: ${reason}.`,
    "Today's decisions were not set.",
    again
      ? "The meeting runs again at its next start today and takes up only the steps it did not finish."
      : "No start is left today; tomorrow's meeting takes up the open decisions.",
  ].join(" ");
}

const finishedSteps = z.record(z.string(), z.string());

/**
 * W8 0j round 3: today's meeting on disk. Each finished step keeps what it said (the scorecard as posted, a colleague's
 * lines) in meeting-<date>.steps.json, so a second start the same day takes it from there and never runs it again; the
 * day's marker is written only by `finish`, after every step. A dry run keeps nothing and skips nothing.
 */
export function meetingDay(home: string, today: string, dry: boolean) {
  const marker = join(home, `meeting-${today}.done`);
  const file = join(home, `meeting-${today}.steps.json`);
  const read = (): Record<string, string> => {
    if (dry || !existsSync(file)) return {};
    try {
      const parsed = finishedSteps.safeParse(JSON.parse(readFileSync(file, "utf8")));
      return parsed.success ? parsed.data : {};
    } catch {
      return {};
    }
  };
  const steps = read();
  return {
    held: (): boolean => !dry && existsSync(marker),
    async once(step: string, run: () => Promise<string>): Promise<string> {
      const kept = steps[step];
      if (kept !== undefined) {
        console.log(`${new Date().toISOString()} meeting step ${step}: finished earlier today`);
        return kept;
      }
      const said = await run();
      steps[step] = said;
      if (!dry) writeFileSync(file, JSON.stringify(steps));
      return said;
    },
    finish(at: Date): void {
      if (!dry) writeFileSync(marker, at.toISOString());
    },
  };
}

async function ask(
  prompt: string,
  model: string,
  research: boolean,
  limitMs: number,
): Promise<{ text: string; usage?: CliUsage }> {
  const desk = join(HOME, "desks", "meeting");
  mkdirSync(desk, { recursive: true });
  return runClaude({
    args: meetingArgs(model, research),
    cwd: desk,
    env: childEnv(),
    prompt,
    timeoutMs: limitMs,
    who: "the step",
  });
}

async function post(
  db: Db,
  dry: boolean,
  thread: string,
  author: { slug: string; name: string; kind: string },
  body: string,
) {
  console.log(`[${thread}] ${author.name}: ${body}\n`);
  if (dry || body.trim() === "") return;
  await db.from("agent_messages").insert({
    thread,
    author_kind: author.kind,
    author_id: author.slug,
    author_name: author.name,
    body: body.slice(0, 20000),
  });
}

async function record(
  db: Db,
  dry: boolean,
  agent: { id: string; model: string },
  summary: string,
  usage: CliUsage | undefined,
  startedAt: string,
) {
  if (dry) return;
  await db.from("agent_runs").insert({
    agent_id: agent.id,
    cause: "schedule",
    state: "done",
    summary: summary.slice(0, 300),
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    turns: 1,
    ...(usage === undefined
      ? {}
      : {
          input_tokens: inputTokens(usage),
          output_tokens: usage.output_tokens,
          cost_microusd: costMicroUsd(agent.model, usage),
        }),
  });
}

/** H143 (3): the field of Matter's answer that retires a decision missed twice in a row. */
const RETIRED_FIELD =
  '"retired": [{"owner": "handle without @", "metric": "the number it was proven by", "reason": "why it is not set again"}], ';

const VOICE =
  "House voice: calm, brief, specific; no em dashes, no hyperbole, no promises of buyers or sales.";

async function main(): Promise<void> {
  const measure = process.argv.includes("--prompts");
  const dry = measure || process.argv.includes("--dry");
  const now = new Date();
  const today = cairoDate(now);
  const day = meetingDay(HOME, today, dry);
  if (day.held()) {
    console.log(`${now.toISOString()} meeting: already held today`);
    return;
  }
  const until = breakerUntil(join(HOME, "breaker.json"));
  if (until !== null) {
    console.log(
      `${now.toISOString()} meeting: the Claude usage limit holds until ${until.toISOString()}`,
    );
    return;
  }
  const db = client();
  const { data: agents, error } = await db
    .from("agents")
    .select("id, slug, name, role, instructions, model, state, tools");
  if (error !== null) throw new Error("meeting: the team could not be read");
  const active = agents.filter((agent) => agent.state !== "off" && agent.state !== "paused");
  const analyst = active.find((agent) => agent.slug === "analyst");
  const matter = agents.find((agent) => agent.slug === "matter");
  const charter = staffCharterFrom(PLAN);
  const card = await scorecard(db, now);
  const numbers = scorecardText(card.lines);
  // Each step's call: timed and logged; a step that stops is said in the team thread. --prompts sends nothing.
  const call = async (
    step: string,
    prompt: string,
    run: () => Promise<{ text: string; usage?: CliUsage }>,
  ): Promise<{ text: string; usage?: CliUsage }> => {
    if (!measure) return meetingStep({ db, dry, step, prompt, again: startsLeftToday(now) }, run);
    console.log(stepLine(new Date(), step, prompt.length, 0, "not sent (--prompts)"));
    return { text: "" };
  };

  // 1. The Analyst, once a day: a second start takes the scorecard it posted.
  const analysis = await day.once("the scorecard", async () => {
    if (analyst === undefined) {
      const plain = `Scorecard for ${today}:\n${numbers}`;
      await post(db, dry, "team", { slug: "system", name: SYSTEM, kind: "system" }, plain);
      return plain;
    }
    const started = new Date().toISOString();
    const prompt = [
      charter,
      `You are ${analyst.name}, ${analyst.role}, at Matter of Place. Your brief: ${analyst.instructions}`,
      VOICE,
      `Today's scorecard (the last seven days against the seven before, read from the database):\n${numbers}`,
      knowledgeBlock(`${numbers} competitors campaigns posts properties`),
      "Search the web for what changed today at editorial and luxury residential property platforms and media that compete for the same owners, agents and readers in California, New York and Florida.",
      'Answer with one JSON object and nothing else: {"observations": ["at most three, each tied to a number above"], "competitors": "a short list of what changed today, or that nothing did", "knowledge": [{"subject": "competitors|posts|properties|campaigns|audience", "text": "one thing worth remembering"}]}',
    ]
      .filter((part) => part !== "")
      .join("\n\n");
    const answer = await call("the scorecard", prompt, () =>
      ask(prompt, analyst.model, analyst.tools.includes("research"), STEP_LIMIT_MS.scorecard),
    );
    const result = lastJson(answer.text, analystAnswer);
    const posted = [
      `Scorecard for ${today}:`,
      numbers,
      result.observations.length === 0
        ? ""
        : `\nWhat matters:\n${result.observations
            .slice(0, 3)
            .map((line, index) => `${String(index + 1)}. ${line}`)
            .join("\n")}`,
      result.competitors === "" ? "" : `\nCompetitors today: ${result.competitors}`,
    ]
      .filter((part) => part !== "")
      .join("\n");
    await post(db, dry, "team", { slug: analyst.slug, name: analyst.name, kind: "agent" }, posted);
    if (!dry)
      remember([
        ...result.knowledge,
        ...(result.competitors === ""
          ? []
          : [{ subject: "competitors", text: result.competitors }]),
      ]);
    await record(db, dry, analyst, "The meeting's scorecard", answer.usage, started);
    return posted;
  });

  // Yesterday's decisions, for every colleague and for Matter.
  const { data: open } = await db
    .from("agent_decisions")
    .select("id, owner_id, decision, due_on, metric")
    .eq("status", "open")
    .order("due_on");
  const slugOf = new Map(agents.map((agent) => [agent.id, agent.slug]));
  const openText = (open ?? [])
    .map(
      (item) =>
        `- [${item.id}] @${slugOf.get(item.owner_id) ?? "?"}: ${item.decision} (due ${item.due_on}; proven by ${item.metric})`,
    )
    .join("\n");

  // 2. Three lines from each colleague.
  const lines: string[] = [];
  for (const agent of active) {
    if (agent.slug === "matter" || agent.slug === "analyst") continue;
    const step = `@${agent.slug}'s three lines`;
    // once a day each: a second start takes the lines a colleague already posted
    const line = await day.once(step, async () => {
      const { data: runs } = await db
        .from("agent_runs")
        .select("summary, state, finished_at")
        .eq("agent_id", agent.id)
        .gte("created_at", new Date(now.getTime() - 24 * 3_600_000).toISOString())
        .order("created_at", { ascending: false })
        .limit(10);
      const mine = (open ?? []).filter((item) => item.owner_id === agent.id);
      const started = new Date().toISOString();
      const prompt = [
        charter,
        `You are ${agent.name}, ${agent.role}, at Matter of Place. Your brief: ${agent.instructions}`,
        VOICE,
        `The meeting is now. What you did in the last day: ${(runs ?? []).map((run) => `${run.state}: ${run.summary ?? ""}`).join("; ") || "nothing yet"}.`,
        mine.length === 0
          ? "You hold no open decision."
          : `Your open decisions:\n${mine.map((item) => `- ${item.decision} (due ${item.due_on}; proven by ${item.metric})`).join("\n")}`,
        fenced("SCORECARD", analysis),
        'Answer with one JSON object and nothing else: {"done": "what you did, with one number", "next": "what you do next", "blocked": "what you wait on, or nothing"}',
      ]
        .filter((part) => part !== "")
        .join("\n\n");
      const answer = await call(step, prompt, () =>
        ask(prompt, agent.model, false, STEP_LIMIT_MS.lines),
      );
      const said = lastJson(answer.text, lineAnswer);
      const body = `Done: ${said.done || "nothing to report"}\nNext: ${said.next || "nothing planned"}\nBlocked on: ${said.blocked || "nothing"}`;
      await post(db, dry, "team", { slug: agent.slug, name: agent.name, kind: "agent" }, body);
      await record(db, dry, agent, "The meeting's three lines", answer.usage, started);
      return `@${agent.slug}: ${body.replaceAll("\n", " · ")}`;
    });
    lines.push(line);
  }

  // 3. Matter decides.
  if (matter === undefined) return;
  const queued = await db
    .from("agent_runs")
    .select("agent_id")
    .eq("state", "queued")
    .lt("created_at", new Date(now.getTime() - 24 * 3_600_000).toISOString());
  const overloaded = [
    ...new Set((queued.data ?? []).map((row) => slugOf.get(row.agent_id) ?? "?")),
  ];
  const team = active.map((agent) => `@${agent.slug} (${agent.name}, ${agent.role})`).join("; ");
  const closedRows = await closedDecisions(db);
  const streaks = missStreaks(closedRows);
  const shown = shownStreaks(streaks);
  const missedText = shown
    .map(
      (streak) =>
        `- @${slugOf.get(streak.owner_id) ?? "?"}, proven by ${streak.metric}: missed ${String(streak.count)} time(s) in a row, last as "${streak.decision}"`,
    )
    .join("\n");
  const started = new Date().toISOString();
  const inputs = matterInputs(PLAN);
  const rules = decisionRules(active);
  const missedPart =
    missedText === ""
      ? ""
      : `Decisions already missed, in a row, by owner and number:\n${missedText}\nA decision missed twice in a row is never set again as it was: retire it with a reason in "retired", or reshape it into something its owner can do, proven by another number. The runner refuses a third with the same owner and number.`;
  const prompt = [
    "You are Matter, the owner-level agent of Matter of Place, chairing the team's daily meeting.",
    inputs.charterText,
    VOICE,
    `The team: ${team}.`,
    fenced("SCORECARD", analysis),
    fenced("THE TEAM'S LINES", lines.join("\n") || "No colleague reported."),
    openText === ""
      ? "There are no open decisions."
      : `Open decisions (close each one due by ${today} as done or missed, by its id):\n${openText}`,
    overloaded.length === 0
      ? "No colleague has work queued longer than a day."
      : `Work queued longer than a day for: ${overloaded.join(", ")}. If a role is overloaded, hire the colleague it needs.`,
    card.gauges.length === 0
      ? ""
      : `Free-tier gauges near their limit: ${card.gauges.join("; ")}. Tell the operator which upgrade comes next and its monthly cost.`,
    knowledgeBlock(`${analysis} ${lines.join(" ")}`),
    inputs.notes === "" ? "" : `Your notes:\n${inputs.notes}`,
    ...rules,
    missedPart,
    `Decide. Answer with one JSON object and nothing else: {"closed": [{"id": "decision id", "status": "done|missed"}], "decisions": [{"owner": "colleague handle without @", "decision": "what", "due_on": "YYYY-MM-DD, ${today} or later", "metric": "the number that proves it"}], ${RETIRED_FIELD}"digest": "at most ten lines for the operator: what moved, what was decided, and in one block everything that needs him", "knowledge": [{"subject": "...", "text": "..."}], "hire": []}. At most five decisions.`,
  ]
    .filter((part) => part !== "")
    .join("\n\n");
  if (measure) {
    // W8 0j round 3: the same prompt as it was before PR 502, which added these parts and nothing else to it
    const added = [...rules, missedPart].filter((part) => part !== "");
    const before =
      prompt.length - added.reduce((sum, part) => sum + part.length + 2, 0) - RETIRED_FIELD.length;
    console.log(
      `${now.toISOString()} meeting step the decisions: before PR 502 ${String(before)} characters; its toolkits ${String(rules[0]?.length ?? 0)}, rulings and rule ${String((rules[1]?.length ?? 0) + (rules[2]?.length ?? 0))}, missed streaks ${String(missedPart.length)} (${String(shown.length)} of ${String(streaks.size)} streaks)`,
    );
  }
  const answer = await call("the decisions", prompt, () => askMatter(prompt, childEnv()));
  const decided = lastJson(answer.text, matterAnswer);
  const idOf = new Map(agents.map((agent) => [agent.slug, agent.id]));
  const { closings, kept, refused } = settleDecisions(
    decided,
    open ?? [],
    closedRows,
    idOf,
    active.map((agent) => agent.slug),
    today,
  );
  let recorded = true;
  if (!dry) {
    for (const item of closings) {
      await db
        .from("agent_decisions")
        .update({ status: item.status, checked_at: new Date().toISOString() })
        .eq("id", item.id);
    }
    if (kept.length > 0) {
      const { error: insertError } = await db.from("agent_decisions").insert(
        kept.map((item) => ({
          meeting_on: today,
          owner_id: idOf.get(item.owner) ?? matter.id,
          decision: item.decision,
          due_on: item.due_on,
          metric: item.metric,
        })),
      );
      recorded = insertError === null;
    }
    remember(decided.knowledge);
    // H101: the meeting reads the colleagues' reports, which may carry outside text, so its hires wait in Approvals.
    await applyHires(db, { slug: matter.slug, id: matter.id }, decided.hire, null, false);
  }
  // H143 (1): every decision still open after the meeting, each colleague's woken in its own thread
  const stillOpen = stillOpenDecisions(
    open ?? [],
    closings,
    kept,
    recorded,
    (owner) => idOf.get(owner) ?? matter.id,
  );
  const woken: { queued: string[]; failed: string[] } = dry
    ? {
        queued: active
          .filter((agent) => agent.slug !== "matter")
          .filter((agent) => stillOpen.some((item) => item.owner_id === agent.id))
          .map((agent) => agent.slug),
        failed: [],
      }
    : await queueDecisionRuns(db, active, stillOpen, today);
  await post(
    db,
    dry,
    "team",
    { slug: "matter", name: "Matter", kind: "agent" },
    decisionsPost({
      today,
      closings,
      kept,
      refused,
      retired: decided.retired,
      recorded,
      woken,
    }),
  );
  if (decided.digest.trim() !== "")
    await post(
      db,
      dry,
      "matter",
      { slug: "matter", name: "Matter", kind: "agent" },
      decided.digest.split("\n").slice(0, 10).join("\n"),
    );
  await record(db, dry, matter, "Chaired the daily meeting", answer.usage, started);
  // every step finished: only now is the day held
  day.finish(now);
}

if (import.meta.main) {
  main().catch((failure: unknown) => {
    if (failure instanceof UsageLimitError) {
      writeFileSync(
        join(HOME, "breaker.json"),
        JSON.stringify({ until: failure.resetAt.toISOString() }),
      );
    }
    console.error(failure instanceof Error ? failure.message : String(failure));
    process.exitCode = 1;
  });
}
