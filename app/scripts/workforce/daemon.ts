// W1 step 4: the workforce daemon, run with bun on the operator's laptop by a hidden scheduled task
// (scripts/workforce/install.ps1). Each pass it (1) wakes colleagues whose `wake_on` lists a new event, (2) claims one
// queued run with `claim_agent_run`, (3) asks the operator's signed-in Claude CLI for the colleague's answer with the
// prompt on stdin, and (4) writes the reply, any proposals for approval and any hire the chief of staff made.
// No model key exists anywhere (H34): the CLI is the operator's own account. It prints no secret and no prompt.
//   bun scripts/workforce/daemon.ts          one pass, then exit (the scheduled task runs it every minute)
//   bun scripts/workforce/daemon.ts --loop   pass after pass until stopped (for watching it live)
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { agentTools, mentionedSlugs } from "../../src/domain/workforce.ts";
import type { Db } from "../../src/server/lib/db.ts";
import {
  ADMIN_BASE,
  MAX_CALLS,
  adminCallSchema,
  adminRoutes,
  allowedActions,
  callProposal,
  checkCall,
  makeCall,
  type AdminCall,
  type CallOutcome,
  type Send,
} from "../matter/actions.ts";
import { askMatter, keepNote, matterInputs, matterPower, matterPrompt } from "../matter/run.ts";
import { staffCharterFrom } from "./charter.ts";
import { childEnv, loadEnvFile, serviceDb as db } from "./env.ts";
import { knowledgeBlock } from "./knowledge.ts";
import { readSiteFacts, writeSitePages } from "./site-facts.ts";
import { makeVoiceover } from "./media.ts";
import {
  briefId,
  decidePiece,
  mediaFor,
  queueReel,
  REEL_TOOL_LINE,
  reelWork,
  reelWorking,
  withReel,
} from "./reel.ts";
import { breakerUntil, type CliUsage, isolatedArgs, runClaude, UsageLimitError } from "./cli.ts";
import { costMicroUsd, inputTokens, lessonsBlock, recallLessons, type Lesson } from "./growth.ts";
import { followMain, mapDue, runnerBusy } from "./follow.ts";
import { readJsonAnswer, type Outcome } from "./answer.ts";
import { fileProposedPost, isStructuredPost, POST_TOOL_LINE, postDeps } from "./proposed-post.ts";
import type { SourceName } from "./criteria.ts";
import { explainsHeld, handToMatter, handUnavailableOwners, ownerExplanation } from "./explain.ts";
import { HOW_REFUSED, postureOf, type Posture } from "./posture.ts";
import {
  allowLine,
  HELD_AUTHOR,
  heldLine,
  MATTER_ALLOWS_AUTHOR,
  OUTSIDE_REPLY_PREFIX,
  OUTSIDE_SUMMARY_MARK,
  outsideGate,
  outsideWords,
  insideLine,
  keyAccountLive,
  startedFromInside,
  teamLineAllowed,
  ownsSource,
  promptData,
  recordOf,
  runShape,
  ruleOutside,
  shownBody,
  triageArgs,
  triageLines,
  triageRun,
  type Triage,
} from "./triage.ts";
import { groundingLines, requestSequence } from "./grounding.ts";
import { requestDesk } from "./request-desk.ts";
import { forgetNewWork, newWorkLines } from "./new-work.ts";
import { colleagueCalls, colleagueRoutes } from "./colleague-calls.ts";
import { applyHires } from "./hiring.ts";
import { checkMail } from "./mail.ts";
import { handToEditor, noteTriage } from "./inbound-mail.ts";
import { bounceFacts, wakes } from "./bounce.ts";
import { checkNewAddresses, refusedAddress } from "./email-check.ts";
import { refreshPolicy, staffPolicy } from "./config.ts";
import { underCeiling } from "./usage-policy.ts";
import { isSupervisorCommand, liveAlive, stalledSupervisorPid } from "../matter/live-alive.ts";

const HOME = join(homedir(), ".mop-workforce");
const CURSOR_FILE = join(HOME, "cursor.json");
const BREAKER_FILE = join(HOME, "breaker.json");
const WORKER = `${hostname()}:${String(process.pid)}`;
// No clock on a colleague's work (operator, 2026-10-15: a 6-minute limit threw away the chief of staff's real work at
// 00:52). A run is stopped only when it prints nothing for this long, which with stream-json means it is stuck.
const CLI_IDLE_MS = 15 * 60_000;
const RUNS_PER_HOUR = 40;
const HISTORY = 24;
const models: Record<string, string> = {
  opus: "claude-opus-5-5",
  sonnet: "claude-sonnet-5-5",
  haiku: "claude-haiku-5-5",
};

// ---------- the database ----------

/** Matter's environment: the employees' one. Its admin key never reaches its process (gap audit item 2). */
function matterEnv(): NodeJS.ProcessEnv {
  return childEnv();
}

function emptyMcpConfig(): string {
  const file = join(HOME, "no-mcp.json");
  if (!existsSync(file)) writeFileSync(file, JSON.stringify({ mcpServers: {} }));
  return file;
}

/**
 * A colleague's command line. A run about an outside message (W8 fifth review), and a run shown a request (W7 item 9a,
 * `runFrom`), is shut off like the triage: no tool, no setting source (so none of the operator's settings, hooks or
 * skills load into it), no MCP server.
 */
export function colleagueArgs(
  model: string,
  research: boolean,
  outside: boolean,
  terminal = false,
): string[] {
  const base = ["-p", "--model", model, "--output-format", "stream-json", "--verbose"];
  if (outside) return [...base, ...isolatedArgs(HOME)];
  // W8 0e (ruling H113): the terminal is file tools in the colleague's own work folder, never a shell (a shell reaches
  // every secret on the disk). Reads and writes allowed only inside that folder, none of the operator's settings, no
  // MCP; the runner gives it no key (childEnv).
  if (terminal)
    return [
      ...base,
      ...["--tools", "Read,Write,Edit,Glob,Grep", "--setting-sources", ""],
      ...["--strict-mcp-config", "--mcp-config", emptyMcpConfig(), "--restricted"],
      ...["--permission-mode", "dontAsk", "--settings", TERMINAL_SETTINGS],
    ];
  return [
    ...base,
    // W8 0e (second review): no settings file loads, so nothing a terminal wrote in a desk (a hook in .claude/) runs.
    "--setting-sources",
    "",
    "--strict-mcp-config",
    "--mcp-config",
    emptyMcpConfig(),
    // H101: no shell, no web fetch, files only inside the desk; anything not allowed is refused, never asked.
    "--restricted",
    "--permission-mode",
    "dontAsk",
    // W2 step 7: a colleague with the research tool may search the web, and nothing more.
    ...(research ? ["--allowedTools", "WebSearch"] : []),
  ];
}

/** W8 0e: what a colleague is told when a person or Matter started its run and it has a terminal. */
export const TERMINAL_LINE =
  "A person or Matter started this run, so you may write files in your work folder (read, write and edit; no shell, no web): drafts, scenes, copy, data, an SVG. Say in your reply what you made and where; anything that leaves the company is still a proposal a person approves.";

/** A colleague's terminal settings (W8 0e): file tools inside the work folder only, nothing that configures a run. */
const TERMINAL_SETTINGS = join(dirname(fileURLToPath(import.meta.url)), "settings-terminal.json");

/**
 * Names that configure a Claude run when found in its folder: a terminal may never leave one behind (second review).
 * Lower case, and compared in lower case: Windows finds `.Claude` or `claude.md` as the same file (third review).
 */
const RUN_CONFIG = new Set([".claude", "claude.md", "claude.local.md", ".mcp.json"]);

/**
 * W8 0e: a colleague's folder for this run. A terminal works in `desks/<slug>/work`; every other run in the desk.
 * Before each run, anything that would configure a run (`RUN_CONFIG`) is removed from the whole desk, so what one run
 * wrote can never steer the next.
 */
export function deskFor(home: string, slug: string, terminal: boolean): string {
  const desk = join(home, "desks", slug);
  mkdirSync(join(desk, "work"), { recursive: true });
  sweep(desk, 0);
  return terminal ? join(desk, "work") : desk;
}

function sweep(dir: string, depth: number): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (RUN_CONFIG.has(entry.name.toLowerCase())) rmSync(path, { recursive: true, force: true });
    else if (entry.isDirectory() && !entry.isSymbolicLink() && depth < 8) sweep(path, depth + 1);
  }
}

/**
 * W8 0e (third review): who started a run, decided in one tested place. A signed-in person's line, or a line posted
 * with an unrevoked operator key; an event, a schedule or any other line starts nothing.
 */
export async function startedInsideFor(
  client: Db,
  cause: string,
  woke: { author_kind: string | null; author_id: string | null },
): Promise<boolean> {
  return startedFromInside(cause, woke, await keyAccountLive(client, woke));
}

/**
 * W8 0e (third review): a colleague run's command line and folder, from its shape. One about outside text is shut
 * off like the triage; a terminal works in its own work folder; any other run reads its desk.
 */
export function colleagueLaunch(
  home: string,
  slug: string,
  model: string,
  shape: { research: boolean; terminal: boolean },
  outside: boolean,
): { args: string[]; cwd: string } {
  return {
    args: colleagueArgs(model, shape.research, outside, shape.terminal),
    cwd: deskFor(home, slug, shape.terminal),
  };
}

function askClaude(
  prompt: string,
  launch: { args: string[]; cwd: string },
): Promise<{ text: string; session?: string; usage?: CliUsage }> {
  return runClaude({
    args: launch.args,
    cwd: launch.cwd,
    env: childEnv(),
    prompt,
    idleMs: CLI_IDLE_MS,
    who: "the colleague",
  });
}

// ---------- waking on events ----------

function readCursor(file: string): string {
  try {
    const value: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (
      typeof value === "object" &&
      value !== null &&
      "at" in value &&
      typeof value.at === "string"
    )
      return value.at;
  } catch {
    // first run: start from now, so a new laptop never replays history
  }
  return new Date().toISOString();
}

/**
 * The runs new events wake (exported for its test, with its own cursor file); the number of runs queued anew. W8 0h
 * fourth review: they are queued through `queue_event_runs`, whose conflict names the partial index's predicate (the
 * upsert this replaced was refused by Postgres on every pass); a failure keeps the cursor where it is, so the next pass
 * wakes the same events again.
 */
export async function wakeOnEvents(client: Db, file = CURSOR_FILE): Promise<number> {
  const cursor = readCursor(file);
  const { data: events, error } = await client
    .from("events")
    .select("id, type, at, entity")
    .gt("at", cursor)
    .order("at")
    .limit(50);
  if (error !== null) throw new Error("workforce: the events could not be read");
  if (events.length === 0) {
    writeFileSync(file, JSON.stringify({ at: cursor }));
    return 0;
  }
  const { data: agents, error: unread } = await client.from("agents").select("id, wake_on, state");
  if (unread !== null) throw new Error("workforce: the colleagues could not be read");
  const rows = events.flatMap((event) =>
    agents
      // W9 item 3: a bounce wakes only the owner of the request or inquiry it is about.
      .filter((agent) => wakes(agent, event))
      .map((agent) => ({ agent_id: agent.id, event_id: event.id })),
  );
  let queued = 0;
  if (rows.length > 0) {
    const { data, error: refused } = await client.rpc("queue_event_runs", {
      p_agents: rows.map((row) => row.agent_id),
      p_events: rows.map((row) => row.event_id),
    });
    if (refused !== null) throw new Error("workforce: the runs on new events could not be queued");
    queued = data;
  }
  writeFileSync(file, JSON.stringify({ at: events.at(-1)?.at ?? cursor }));
  return queued;
}

// ---------- one run ----------

const allowedProposal: Record<string, string> = {
  reply_inquiry: "draft_reply",
  social_post: "draft_post",
  newsletter_issue: "draft_newsletter",
  campaign_plan: "draft_campaign",
};

/**
 * W8 fourth review: what a run's answer becomes, decided in one place the runner only carries out. The answer is
 * ruled by the run's shape (a triaged run keeps only its source's proposals, a held read nothing that acts); the reply
 * goes where the shape says; a mention wakes colleagues only for a run not woken by a message and not about outside
 * text; media and kept notes need Matter at full power; a proposal needs the colleague's own drafting tool; and a run
 * about outside text leaves only fixed words as summaries.
 */
export function answerPlan(input: {
  agent: { slug: string; tools: readonly string[] };
  answer: Outcome;
  shape: ReturnType<typeof runShape>;
  triage: Triage | null;
  power: "full" | "read";
  cause: string;
  /** W7 item 9: the run was shown what a submitter typed or sent (`context`'s `request`). */
  request?: boolean;
}) {
  const { agent, shape, triage, power } = input;
  const isMatter = agent.slug === "matter";
  const ruled = ruleOutside(input.answer, shape.rule);
  const fromRequest = ruleRequest(ruled.kept, input.request === true);
  const result = fromRequest.kept;
  const fixed = outsideWords(shape.rule) ?? (input.request === true ? REQUEST_WORDS : null);
  const full = isMatter && power === "full";
  const dropped = [
    ...(ruled.dropped.length === 0
      ? []
      : [
          shape.rule === "explain"
            ? `Not proposed: ${ruled.dropped.join(", ")}; an explanation of a held message proposes nothing (W8 0d).`
            : `Not proposed: ${ruled.dropped.join(", ")}; not allowed for ${triage === null ? "a held outside message" : triage.source} (W8 0c).`,
        ]),
    ...(fromRequest.dropped.length === 0
      ? []
      : [
          `Not done: ${fromRequest.dropped.join(", ")}; a run shown a request's typed fields or photographs may not (W7 item 9).`,
        ]),
  ];
  return {
    result,
    dropped: dropped.length === 0 ? null : dropped.join(" "),
    keepNote: full,
    // W2 step 5 and W7 item 20: Matter at full power, or a colleague with `request_reel` (one reel); a Matter read
    // run asks for no media (W8 review), and a triaged run has none left after the ruling.
    media: isMatter && !full ? [] : mediaFor(result.media, isMatter, agent.tools),
    reply:
      result.reply === ""
        ? null
        : {
            thread: shape.place.thread,
            author_id: shape.place.author_id,
            body: result.reply.slice(0, 20000),
          },
    wake: input.cause !== "message" && ruled.wakeMentioned && fromRequest.wakeMentioned,
    proposals: result.proposals
      .filter((proposal) => agent.tools.includes(allowedProposal[proposal.action] ?? ""))
      .map((proposal) => ({
        action: proposal.action,
        summary: fixed?.proposal(proposal.action) ?? proposal.summary,
        content: proposal.content,
      })),
    summary: fixed?.run ?? (result.task || result.reply).slice(0, 300),
    // W8 0d: only Matter's read of a held message can let its owner answer it.
    allow: shape.rule === "held" && input.answer.allow,
    // and how, as one of the closed postures (null: a "how" off the list, so no allowance is made, H117)
    how: shape.rule === "held" && input.answer.allow ? postureOf(input.answer.how) : null,
  };
}

/**
 * W7 item 9a (reviews of 2026-10-16, ruling H132): a run shown a request's typed fields or photographs
 * (request-desk.ts) holds words a submitter chose, so its answer reaches no other colleague's run: no colleague woken by
 * a mention, no admin call (its reason becomes a thread line and a team line), no hire, no media request (the one-hop
 * paths `ruleOutside` closes for outside messages). Its proposals stay, each waiting for a person, under fixed words
 * (`REQUEST_WORDS`). Exported for its test.
 */
export function ruleRequest<
  A extends { actions: readonly unknown[]; hire: readonly unknown[]; media: readonly unknown[] },
>(answer: A, received: boolean): { kept: A; wakeMentioned: boolean; dropped: string[] } {
  if (!received) return { kept: answer, wakeMentioned: true, dropped: [] };
  return {
    kept: { ...answer, actions: [], hire: [], media: [] },
    wakeMentioned: false,
    dropped: [
      ...(answer.actions.length > 0 ? ["admin calls"] : []),
      ...(answer.hire.length > 0 ? ["hires"] : []),
      ...(answer.media.length > 0 ? ["media"] : []),
    ],
  };
}

/**
 * The words a run shown a request leaves behind (W7 item 9a, third review): its proposals' summaries (a team line when
 * approved, a lesson when declined, a line of later pending lists) and its run summary (the daily meeting), as for a
 * run about an outside message (`outsideWords`). The proposal's content is untouched: a person reads it in Approvals.
 */
export const REQUEST_WORDS = {
  proposal: (action: string) => `A ${action} proposal about a request ${OUTSIDE_SUMMARY_MARK}`,
  run: "Worked on a request it was shown",
};

/**
 * W7 item 9a (third review, ruling H132): how a run goes, from what its context showed it, decided in one tested place
 * the runner only carries out (`runOnce`). A run shown a request is shaped like a run about an outside message: no
 * terminal and no web search, no admin call or hire offered, launched shut off (`outside`: no tool at all on this
 * runner; the outside toolkit of ruling H115 reads its own folder and writes and runs nothing), and its reply written in
 * its own thread under an `OUTSIDE_REPLY_PREFIX` author, so every later reader sees it fenced (`shownBody`). Its plan
 * is ruled with the request (`ruleRequest`, `REQUEST_WORDS`).
 */
export function runFrom<T extends { slug: string; tools: readonly string[] }>(
  agent: T,
  thread: string,
  seen: { triage: Triage | null; request: boolean },
  matterReadsHeld: boolean,
  startedInside: boolean,
) {
  const base = runShape(agent, thread, seen.triage, matterReadsHeld, startedInside);
  const shape = seen.request
    ? {
        ...base,
        terminal: false,
        research: false,
        agent: {
          ...base.agent,
          tools: base.agent.tools.filter((tool) => tool !== "admin_call" && tool !== "hire"),
        },
        place: { thread: agent.slug, author_id: `${OUTSIDE_REPLY_PREFIX}${agent.slug}` },
      }
    : base;
  return {
    shape,
    outside: seen.triage !== null || seen.request,
    plan: (answer: Outcome, power: "full" | "read", cause: string) =>
      answerPlan({
        agent,
        answer,
        shape,
        triage: seen.triage,
        power,
        cause,
        request: seen.request,
      }),
  };
}

/**
 * The start of every pass (exported for its test): Matter's side chat says "online" while this runner passes (one touch
 * of Matter's row), and the newest work is read afresh for the pass's runs (W7 item 9, `newWorkLines`).
 */
export async function beginPass(client: Db): Promise<void> {
  await client
    .from("agents")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("slug", "matter")
    .neq("state", "working");
  forgetNewWork();
}

/**
 * W8 0d: Matter's decision that a held message may be answered. The runner writes it in the owner's thread in its own
 * words with the record, and wakes the owner on it; that run triages the record afresh and may propose within the
 * criteria only (a person approves). The posture reaches it only in the runner's fixed words; an allowance in a posture
 * off the list is not made, and the thread says so. A decision that cannot be written fails the run. Exported for its
 * test.
 */
export async function allowForOwner(
  client: Db,
  agents: readonly { id: string; slug: string }[],
  owner: string,
  record: { source: SourceName; id: string },
  how: Posture | null,
): Promise<void> {
  const ownerRow = agents.find((row) => row.slug === owner);
  if (ownerRow === undefined) throw new Error("the held message's owner is not in the team");
  if (how === null) {
    await say(client, owner, HOW_REFUSED);
    return;
  }
  const { data: rows, error } = await client
    .from("agent_messages")
    .insert({
      thread: owner,
      author_kind: "system",
      author_id: MATTER_ALLOWS_AUTHOR,
      author_name: "Matter",
      body: allowLine(record, owner, how),
    })
    .select("id");
  const line = rows?.[0];
  if (error !== null || line === undefined)
    throw new Error("Matter's decision could not be written");
  const { error: queueError } = await client
    .from("agent_runs")
    .insert({ agent_id: ownerRow.id, cause: "message", message_id: line.id });
  if (queueError !== null)
    throw new Error("the owner's run on Matter's decision could not be queued");
}

/**
 * The situation a run's prompt is built from, and the triage of its outside message (W8 0b). Exported for the test
 * that proves the prompt never holds outside text; `ask` is the tool-less triage call. Matter's own run on a held line
 * (`matterReadsHeld`) is the one reader shown that line; every other reader sees it as a placeholder.
 */
export async function context(
  client: Db,
  run: { agent_id: string; cause: string; event_id: string | null; message_id: string | null },
  thread: string,
  ask: (prompt: string) => Promise<string> = askTriage,
  matterReadsHeld = false,
  owns: (source: SourceName) => boolean = () => true,
  startedInside = false,
) {
  const parts: string[] = [];
  let event: { type: string; entity: string | null; entity_id: string | null } | null = null;
  if (run.event_id !== null) {
    const { data: rows } = await client
      .from("events")
      .select("type, payload, at, entity, entity_id")
      .eq("id", run.event_id)
      .limit(1);
    const data = rows?.[0] ?? null;
    // W8 0b: an event that cannot be read is not guessed at; the run fails and says so (fails closed).
    if (data === null) throw new Error("the event that woke this run could not be read");
    event = data;
    parts.push(
      `What woke you: the event ${data.type} at ${data.at}.\nIts data: ${promptData(data.payload)}`,
    );
    // W9 item 3: the failed address and the phone, which the event does not carry.
    const facts = data.type === "email.bounced" ? await bounceFacts(client, data) : null;
    if (facts !== null) parts.push(facts);
    // W9 item 5: a run about a request follows the review sequence for the state the request is in.
    const sequence = await requestSequence(client, data);
    if (sequence !== null) parts.push(sequence);
  }
  // P-3454: the line that woke the run, and the colleague's real open proposals, as facts before the thread.
  const [woke, pending] = await Promise.all([
    run.message_id === null
      ? Promise.resolve(null)
      : client
          .from("agent_messages")
          .select("author_id, author_name, author_kind, body")
          .eq("id", run.message_id)
          .limit(1)
          .then(({ data }) => {
            // W8 review: fails closed, as the event does.
            const line = data?.[0];
            if (line === undefined)
              throw new Error("the line that woke this run could not be read");
            return line;
          }),
    client
      .from("agent_approvals")
      .select("action, summary, created_at")
      .eq("agent_id", run.agent_id)
      .eq("state", "pending")
      .order("created_at")
      .then(({ data }) => data ?? []),
  ]);
  // W8 0b: an outside message reaches the prompt only as its triage; its text stays in the database for a person.
  // W8 0d: Matter's read of a held line is no triaged run (its owner's explanation of that line is).
  const triage = await triageRun(client, ask, event, matterReadsHeld ? null : woke, owns);
  if (triage !== null) parts.push(...triageLines(triage));
  const wokeShown =
    woke === null
      ? null
      : matterReadsHeld && woke.author_id === HELD_AUTHOR
        ? woke
        : { ...woke, body: shownBody(woke) };
  parts.push(...groundingLines(wokeShown, pending));
  // W7 item 9a: a run of the request's owner about a request receives the request itself (request-desk.ts), named by
  // its event or its line, after the triage read and classified what its submitter typed; no one else is shown a
  // request (H132).
  const line = woke === null ? null : shownBody(woke);
  const desk = owns("submission")
    ? await requestDesk(client, run.agent_id, event, line, { triage, ask })
    : { lines: [], received: false };
  parts.push(...desk.lines);
  // W8 fourth review: a run about an outside message sees the triage, its own pending list and the site's facts, and
  // nothing of the company's inside (no thread history, decisions or counts), so no reply can carry them. A run shown a
  // request's typed fields is such a run whatever woke it (H132: the path of W8 0a to 0c, no second one).
  if (triage === null && !desk.received) {
    const { data: messages } = await client
      .from("agent_messages")
      .select("author_kind, author_id, author_name, body, created_at")
      .eq("thread", thread)
      .order("created_at", { ascending: false })
      .limit(HISTORY);
    if (messages !== null && messages.length > 0) {
      parts.push(
        `The conversation so far (${thread === "team" ? "the team chat" : "your direct thread"}, oldest first):\n` +
          messages
            // W8 0e (second review): a run that may hold a terminal reads only people's and keys' lines; any other
            // line may carry words that passed through an outside message
            .filter((message) => !startedInside || insideLine(message))
            .reverse()
            .map((message) => `${message.author_name}: ${shownBody(message)}`)
            .join("\n"),
      );
    }
    const { data: decisions } = await client
      .from("agent_decisions")
      .select("decision, due_on, metric")
      .eq("owner_id", run.agent_id)
      .eq("status", "open")
      .order("due_on");
    if (decisions !== null && decisions.length > 0)
      parts.push(
        `Your open decisions from the daily meeting (work them; the next meeting marks each done or missed):\n` +
          decisions
            .map((item) => `- ${item.decision} (due ${item.due_on}; proven by ${item.metric})`)
            .join("\n"),
      );
    const [requests, inquiries, properties] = await Promise.all([
      client
        .from("submissions")
        .select("id", { count: "exact", head: true })
        .eq("workflow_state", "Submitted"),
      client.from("inquiries").select("id", { count: "exact", head: true }),
      client
        .from("properties")
        .select("id", { count: "exact", head: true })
        .eq("editorial_state", "published"),
    ]);
    parts.push(
      `The business right now: ${String(requests.count ?? 0)} new requests, ${String(inquiries.count ?? 0)} inquiries in total, ${String(properties.count ?? 0)} published properties.`,
    );
    // W7 item 9: the newest requests and inquiries themselves, for their owners (new-work.ts).
    parts.push(...(await newWorkLines(client, owns)));
  }
  // W5 item 13: our own products, prices and markets, so no reply brackets a price it could have read.
  parts.push(await readSiteFacts());
  // W8 0d: the record a held line names, for Matter's read of it (the runner wrote it, last in the line).
  const heldRecord =
    matterReadsHeld && woke?.author_id === HELD_AUTHOR ? recordOf(woke.body) : null;
  return { situation: parts.join("\n\n"), triage, heldRecord, request: desk.received };
}

/**
 * W8 0d: holds an outside message for Matter in its owner's thread and queues the owner's run on it first: the owner
 * explains the context to the team, and the end of that run queues Matter's (explain.ts, `handToMatter`). A hold that
 * cannot be made fails the run, so the message is never dropped in silence: Matter or the owner missing, the line not
 * written, or the owner's run not queued. Exported for its test.
 */
export async function holdForMatter(
  client: Db,
  agents: readonly { id: string; slug: string }[],
  owner: string,
  triage: Triage,
  heldThisHour = 0,
): Promise<void> {
  const matterRow = agents.find((row) => row.slug === "matter");
  if (matterRow === undefined) throw new Error("Matter is not in the team, so nothing can be held");
  const ownerRow = agents.find((row) => row.slug === owner);
  if (ownerRow === undefined)
    throw new Error("the owner of the held message is not in the team, so it cannot be explained");
  const { data: heldRows, error: heldError } = await client
    .from("agent_messages")
    .insert({
      thread: owner,
      author_kind: "system",
      author_id: HELD_AUTHOR,
      author_name: "Triage",
      body: heldLine(triage, owner),
    })
    .select("id");
  const held = heldRows?.[0];
  if (heldError !== null || held === undefined)
    throw new Error("the held line could not be written");
  // W8 fourth review: past HELD_PER_HOUR an hour, a held line waits for a person and Matter is not run on it, so a
  // stream of such messages cannot spend the weekly allowance; the team is told once, when the cap is reached.
  if (heldThisHour >= HELD_PER_HOUR) {
    if (heldThisHour === HELD_PER_HOUR)
      await say(
        client,
        "team",
        `More than ${String(HELD_PER_HOUR)} outside messages were held this hour: the rest wait in their owners' threads for a person.`,
      );
    return;
  }
  // An owner that is paused or off at any time after this never claims the run: `handUnavailableOwners` (explain.ts),
  // swept at the start of every runner loop, hands such a line to Matter.
  const { error: queueError } = await client
    .from("agent_runs")
    .insert({ agent_id: ownerRow.id, cause: "message", message_id: held.id });
  if (queueError !== null)
    throw new Error("the owner's explanation of the held line could not be queued");
}

/** How many held messages an hour Matter reads; the rest wait for a person (W8 fourth review). */
export const HELD_PER_HOUR = 10;

/** W8 0b: the tool-less triage call (triage.ts); its own short time limit, so a stuck call fails closed. */
async function askTriage(prompt: string): Promise<string> {
  const { args, cwd } = triageArgs(HOME);
  return (
    await runClaude({
      args,
      cwd,
      env: childEnv(),
      prompt,
      timeoutMs: 2 * 60_000,
      who: "the triage",
    })
  ).text;
}

function promptFor(
  agent: { name: string; slug: string; role: string; instructions: string; tools: string[] },
  team: { name: string; slug: string; role: string }[],
  situation: string,
  lessons = "",
  charter = "",
  knowledge = "",
  terminal = false,
): string {
  const may = agentTools.filter((tool) => agent.tools.includes(tool));
  return [
    ...(charter === "" ? [] : [charter]),
    `You are ${agent.name} (@${agent.slug}), ${agent.role}, at Matter of Place: a selective editorial and distribution platform for exceptional existing residential property in California, New York and Florida, a product of Omnikom LLC.`,
    "House voice for everything you write: calm, brief, specific; no em dashes, no hyperbole, no guarantees of buyers, leads or sales; price never equals merit.",
    `Your brief: ${agent.instructions}`,
    ...(knowledge === "" ? [] : [knowledge]),
    ...(lessons === "" ? [] : [lessons]),
    `Your colleagues: ${team.map((member) => `@${member.slug} (${member.name}, ${member.role})`).join("; ")}. Mention a colleague with @handle to hand them work.`,
    `You may: ${may.join(", ")}. Anything that leaves the company (a reply, a post, a newsletter) is a proposal a person approves; you never send it yourself.`,
    ...(agent.tools.includes("admin_call")
      ? [
          `To change something in the admin, add to your JSON an "actions" list: {"method", "path" with the real id, "body", "why"}. Only these routes are yours: ${(colleagueRoutes[agent.slug] ?? []).join(", ")}. Read the record first. Each waits in Approvals until a person approves it; you never make it yourself.`,
        ]
      : []),
    ...(agent.tools.includes("request_reel") ? [REEL_TOOL_LINE] : []),
    ...(agent.tools.includes("draft_post") ? [POST_TOOL_LINE] : []),
    ...(terminal ? [TERMINAL_LINE] : []),
    situation,
    'Answer with one JSON object and nothing else: {"reply": "what you say in the conversation, short", "task": "a few words for the office board on what you did", "proposals": [{"action": "reply_inquiry|social_post|newsletter_issue|campaign_plan", "summary": "one line", "content": {"body": "the full text", "to": "who it is for if any"}}], "hire": [{"slug": "handle", "name": "Name", "role": "what they do", "instructions": "their brief", "model": "sonnet", "wake_on": [], "tools": ["read_business", "chat"]}]}. Leave proposals and hire empty unless they are needed and you may do them.',
  ].join("\n\n");
}

/** One claimed run, start to end. Exported for the W8 0d test that walks a held message through the runner. */
export async function runOnce(client: Db): Promise<boolean> {
  // W8 0d second review: an explanation queued for an owner that is paused or off is handed to Matter, whatever the
  // loop does next (explain.ts).
  await handUnavailableOwners(client);
  const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
  const { count } = await client
    .from("agent_runs")
    .select("id", { count: "exact", head: true })
    .gte("started_at", hourAgo);
  if ((count ?? 0) >= RUNS_PER_HOUR) return false;

  const policy = staffPolicy();
  const { data: claimed, error } = await client.rpc("claim_agent_run", {
    p_worker: WORKER,
    // Longer than Matter's longest run (45 minutes at full power), so no other runner claims a run still in work.
    p_lease_seconds: 3000,
    // W5: while Matter's live session runs, a person's line to Matter is its work.
    p_skip_live: liveAlive(),
    // W6 item 1: with the weekly allowance over 90%, only a person's own line is answered.
    p_person_only: policy.personOnly,
  });
  if (error !== null) throw new Error("workforce: the claim failed");
  const run = claimed[0];
  if (run === undefined) return false;

  const { data: agents } = await client
    .from("agents")
    .select("id, slug, name, role, instructions, model, tools, state");
  const agent = agents?.find((row) => row.id === run.agent_id);
  if (agent === undefined) return true;
  let thread = "team";
  let authorKind: string | null = null;
  let wokeBy: string | null = null;
  if (run.message_id !== null) {
    const { data: message } = await client
      .from("agent_messages")
      .select("thread, author_kind, author_id")
      .eq("id", run.message_id)
      .single();
    // A line that cannot be read fails the run inside `context` (W8 review), where the failure is recorded.
    thread = message?.thread ?? "team";
    authorKind = message?.author_kind ?? null;
    wokeBy = message?.author_id ?? null;
  }
  // W8 0d: the owner's run on a held line explains it, and any end of it hands the line to Matter.
  const explains =
    run.message_id !== null &&
    explainsHeld(agent.slug, { thread, author_kind: authorKind, author_id: wokeBy });
  await client
    .from("agents")
    .update({ state: "working", current_task: "Reading", last_seen_at: new Date().toISOString() })
    .eq("id", agent.id);

  try {
    const matterReadsHeld = agent.slug === "matter" && wokeBy === HELD_AUTHOR;
    // W8 0e: a key's line counts only if its account is an unrevoked agent key.
    const woke = { author_kind: authorKind, author_id: wokeBy };
    const startedInside = await startedInsideFor(client, run.cause, woke);
    const {
      situation,
      triage,
      heldRecord,
      request: shownRequest,
    } = await context(
      client,
      run,
      thread,
      askTriage,
      matterReadsHeld,
      (source) => ownsSource(source, agent.slug),
      startedInside,
    );
    // W8 0a/0d: an outside message is answered by its owner only; anyone else it woke does nothing with it.
    const gate = outsideGate(triage, agent.slug);
    if (explains && gate !== "explain")
      throw new Error("the held line names no record its owner can explain");
    // W8 0h: a person's email shows in the admin whether its triage let the owner answer it or held it.
    await noteTriage(client, triage, gate);
    // W8 0h review: a property offered to any of our addresses goes to the Editor once its triage says so.
    const handed = await handToEditor(client, triage, gate, agent.slug, run.event_id);
    if (gate === "not_owner" || handed) {
      await client
        .from("agent_runs")
        .update({
          state: "done",
          finished_at: new Date().toISOString(),
          summary: handed ? "Handed to the Editor (W8 0h)" : "Not its owner (W8 0a)",
        })
        .eq("id", run.id);
      return true;
    }
    // W8 0d: a message outside its criteria, or one that tries to direct the AI, wakes no one to answer it: it is held
    // in the owner's thread for Matter, who reads it without power and decides. The run ends here, before any prompt.
    // Every other reader of that thread sees the held line only as a placeholder (shownBody).
    if (gate === "hold" && triage !== null) {
      const { count: heldThisHour } = await client
        .from("agent_messages")
        .select("id", { count: "exact", head: true })
        .eq("author_id", HELD_AUTHOR)
        .gte("created_at", new Date(Date.now() - 60 * 60_000).toISOString());
      await holdForMatter(client, agents ?? [], agent.slug, triage, heldThisHour ?? 0);
      await client
        .from("agent_runs")
        .update({
          state: "done",
          finished_at: new Date().toISOString(),
          summary: `Held for Matter: ${triage.intent}${triage.instructions_to_ai ? ", tries to direct the AI" : ""}`,
        })
        .eq("id", run.id);
      console.log(`${new Date().toISOString()} ${agent.slug} held an outside message for Matter`);
      return true;
    }
    // W2 step 6: the lessons this colleague has been taught, recalled for what woke it.
    const { data: lessonRows } = await client
      .from("agent_lessons")
      .select("id, trigger, action, uses, last_used_at, created_at")
      .eq("status", "active")
      .or(`agent_id.eq.${agent.id},agent_id.is.null`);
    const shown: Lesson[] = recallLessons(lessonRows ?? [], situation);
    const lessons = lessonsBlock(shown);
    const team = (agents ?? [])
      .filter((row) => row.id !== agent.id)
      .map(({ name, slug, role }) => ({ name, slug, role }));
    const isMatter = agent.slug === "matter";
    // W7 item 9a: what the context showed decides the shape, the launch and the plan, in one tested place.
    const decided = runFrom(
      agent,
      thread,
      { triage, request: shownRequest },
      matterReadsHeld,
      startedInside,
    );
    const { shape } = decided;
    // H101: only a signed-in person's message gives Matter full power, keeps its notes and lets it hire directly.
    const power = isMatter ? matterPower(run.cause, authorKind) : "read";
    const answer = isMatter
      ? await askMatter(
          matterPrompt({
            ...matterInputs(resolve(import.meta.dir, "../../../workspace/05-plans/W2.md")),
            thread: situation,
            business: lessons,
            power,
            held: matterReadsHeld,
            // W8 0d: the owner's explanation, fenced as data; null when there is none (its run failed, said nothing, or never ran)
            explanation:
              matterReadsHeld && run.message_id !== null
                ? await ownerExplanation(
                    client,
                    { id: run.message_id, thread },
                    (agents ?? []).find((row) => row.slug === thread)?.id ?? "",
                  )
                : null,
          }),
          matterEnv(),
          power,
          matterReadsHeld,
        )
      : await askClaude(
          promptFor(
            // W8 0c: a run about an outside message is not offered admin calls or hires at all.
            shape.agent,
            team,
            situation,
            lessons,
            staffCharterFrom(resolve(import.meta.dir, "../../../workspace/05-plans/W2.md")),
            triage === null ? knowledgeBlock(situation) : "",
            shape.terminal,
          ),
          colleagueLaunch(
            HOME,
            agent.slug,
            models[underCeiling(agent.model, policy.colleagueCeiling)] ??
              models["sonnet"] ??
              "claude-sonnet-5-5",
            shape,
            decided.outside,
          ),
        );
    // W8 0c: a run about an outside message keeps only the proposals its source allows: no admin call, no hire, no
    // media, no colleague woken by a mention. What it drops is said in the thread. Matter's read of a held line keeps
    // nothing that acts (W8 review): it read the outside text itself.
    // The plan is decided in one tested function (W8 fourth review); the runner only carries it out.
    const plan = decided.plan(readJsonAnswer(answer.text), power, run.cause);
    const result = plan.result;
    const { place } = shape;
    if (plan.dropped !== null) await say(client, place.thread, plan.dropped);
    if (plan.keepNote) keepNote(result.note);
    if (plan.allow && heldRecord !== null)
      await allowForOwner(client, agents ?? [], thread, heldRecord, plan.how);
    if (plan.allow && heldRecord === null)
      await say(
        client,
        thread,
        "Matter's decision could not be applied: the held message names no record.",
      );
    const media = plan.media;
    let reel: { request_id: string; name: string } | null = null;
    let replyId: string | null = null;

    if (plan.reply !== null) {
      // W8 0e (second review): the woken colleagues read this reply, never whatever line is newest by then.
      const { data: written } = await client
        .from("agent_messages")
        .insert({
          thread: plan.reply.thread,
          author_kind: "agent",
          author_id: plan.reply.author_id,
          author_name: agent.name,
          body: plan.reply.body,
        })
        .select("id")
        .single();
      replyId = written?.id ?? null;
      // A colleague handing work to another wakes them, once.
      const handed = mentionedSlugs(result.reply).filter((slug) => slug !== agent.slug);
      const targets = (agents ?? []).filter(
        (row) => handed.includes(row.slug) && row.state !== "off" && row.state !== "paused",
      );
      if (targets.length > 0 && plan.wake && written !== null)
        await client
          .from("agent_runs")
          .insert(
            targets.map((row) => ({ agent_id: row.id, cause: "message", message_id: written.id })),
          );
    }
    for (const request of media) {
      if (request.skill === "reel") {
        // W7 item 19: a reel takes many minutes, so it waits in the studio for the reel pass, never inside a run.
        const folder = queueReel(request, { agent: agent.slug, thread });
        const requestId = briefId(folder);
        if (requestId !== null) reel = { request_id: requestId, name: request.name };
        await say(client, thread, `The reel "${request.name}" is queued in the studio: ${folder}`);
        continue;
      }
      if (request.skill === "studio") {
        // W8 0f: Matter's decision on a draft in the studio (media is kept only for Matter at full power, so a person's
        // word is behind it); the runner's pass then uploads, revises or sends the preview.
        await say(client, thread, decidePiece(request).line);
        continue;
      }
      await client
        .from("agents")
        .update({ current_task: `Making the voice-over "${request.name}"` })
        .eq("id", agent.id);
      const made = makeVoiceover(request);
      await client.from("agent_messages").insert({
        thread,
        author_kind: "agent",
        author_id: agent.slug,
        author_name: agent.name,
        body:
          made.path === undefined
            ? `The voice-over "${request.name}" could not be made: ${made.error ?? "no reason"}.`
            : `The voice-over "${request.name}" is ready: ${made.path}`,
      });
    }
    if (isMatter) await proposeCalls(client, agent, run.id, thread, result.actions);
    // W5 item 12: a colleague with admin_call proposes calls on its own routes only; the rest are refused and said.
    if (!isMatter && agent.tools.includes("admin_call")) {
      const { allowed, refused } = colleagueCalls(agent.slug, result.actions);
      if (refused.length > 0) await say(client, thread, `Not proposed: ${refused.join("; ")}.`);
      await proposeCalls(client, agent, run.id, thread, allowed);
    }
    for (const proposal of plan.proposals) {
      // W8 item 10 (H135): a post with its channels and files goes to Proposed posts, not to Approvals.
      if (isStructuredPost(proposal)) {
        const filed = await fileProposedPost(postDeps(client), {
          agent: agent.slug,
          run: run.id,
          summary: proposal.summary,
          post: proposal.content.post,
        });
        await say(
          client,
          thread,
          "id" in filed
            ? `The post "${proposal.summary}" waits in Proposed posts for a person's approval.`
            : `The post "${proposal.summary}" was not proposed: ${filed.refused}.`,
        );
        continue;
      }
      // W7 item 20: a post or a plan of this run carries the reel it asked for; the hash covers what is stored.
      const content = withReel(proposal.action, proposal.content, reel);
      await client.from("agent_approvals").insert({
        agent_id: agent.id,
        run_id: run.id,
        action: proposal.action,
        summary: proposal.summary,
        content,
        content_hash: createHash("sha256").update(JSON.stringify(content)).digest("hex"),
      });
    }
    if (agent.tools.includes("hire")) {
      await applyHires(
        client,
        { slug: agent.slug, id: agent.id },
        result.hire,
        run.id,
        power === "full",
      );
    }
    const finished = {
      state: "done" as const,
      finished_at: new Date().toISOString(),
      // W8 review: a run about an outside message, and Matter's read of a held line, is summed up in fixed words;
      // its own words could carry the outside text into the meeting and the live session's digest.
      summary: plan.summary,
      session_id: "session" in answer && typeof answer.session === "string" ? answer.session : null,
      turns: 1,
      lessons_used: shown.map((lesson) => lesson.id),
      ...(answer.usage === undefined
        ? {}
        : {
            input_tokens: inputTokens(answer.usage),
            output_tokens: answer.usage.output_tokens,
            cost_microusd: costMicroUsd(agent.model, answer.usage),
          }),
    };
    // W8 0d second review: the line this run wrote as its reply, which Matter's read shows as the explanation.
    const { error: finishFailed } = await client
      .from("agent_runs")
      .update({ ...finished, reply_message_id: replyId })
      .eq("id", run.id);
    // The runner follows main at once, the migration that adds the column reaches the database with deploy's dev job:
    // in between the update above fails, and a run left `running` would be claimed and answered again (followups review).
    if (finishFailed !== null) await client.from("agent_runs").update(finished).eq("id", run.id);
    // A lesson shown is a lesson used: its count ranks it, and the weekly review promotes the ones used often.
    const now = new Date().toISOString();
    for (const lesson of shown) {
      await client
        .from("agent_lessons")
        .update({ uses: lesson.uses + 1, last_used_at: now })
        .eq("id", lesson.id);
    }
    if (explains && run.message_id !== null)
      await handToMatter(client, agents ?? [], run.message_id, thread, false);
    console.log(`${new Date().toISOString()} ${agent.slug} done`);
  } catch (failure) {
    if (failure instanceof UsageLimitError) {
      // Gap audit item 32: the operator's Claude limit is spent. The run goes back to the queue untouched and the
      // breaker stops every claim until the reset, so no work is lost and nothing fails in a loop.
      writeFileSync(BREAKER_FILE, JSON.stringify({ until: failure.resetAt.toISOString() }));
      await client
        .from("agent_runs")
        .update({ state: "queued", worker: null, lease_until: null })
        .eq("id", run.id);
      console.log(`${new Date().toISOString()} ${agent.slug} waits: ${failure.message}`);
      return false;
    }
    const message = failure instanceof Error ? failure.message : String(failure);
    await client
      .from("agent_runs")
      .update({
        state: "failed",
        finished_at: new Date().toISOString(),
        error: message.slice(0, 300),
      })
      .eq("id", run.id);
    console.log(`${new Date().toISOString()} ${agent.slug} failed: ${message}`);
    // 2026-10-13 test 1 (P-3453): a run that stops says so where the person is waiting, never in silence.
    await say(
      client,
      thread,
      agent.slug === "matter"
        ? `Matter stopped before finishing: ${message}. The work so far stays in Matter's desk; your next message picks it up from there.`
        : `${agent.name} stopped before finishing: ${message}.`,
    );
    // W8 0d: a failed explanation is said, and does not stop Matter's decision.
    if (explains && run.message_id !== null)
      await handToMatter(client, agents ?? [], run.message_id, thread, true);
  } finally {
    await client
      .from("agents")
      .update({
        state: agent.state === "working" ? "idle" : agent.state,
        current_task: null,
        last_seen_at: new Date().toISOString(),
      })
      .eq("id", agent.id);
  }
  return true;
}

/** One backlog run: the colleague with an open decision whose last scheduled run is the oldest, at most every 3 hours. */
async function wakeBacklog(client: Db): Promise<void> {
  const { data: open } = await client
    .from("agent_decisions")
    .select("owner_id")
    .eq("status", "open");
  const owners = [...new Set((open ?? []).map((row) => row.owner_id))];
  if (owners.length === 0) return;
  const { data: agents } = await client.from("agents").select("id, state").in("id", owners);
  const idle = (agents ?? []).filter((agent) => agent.state === "idle").map((agent) => agent.id);
  const since = new Date(Date.now() - 3 * 3_600_000).toISOString();
  const { data: recent } = await client
    .from("agent_runs")
    .select("agent_id")
    .in("agent_id", idle)
    .gte("created_at", since);
  const busy = new Set((recent ?? []).map((row) => row.agent_id));
  const next = idle.find((id) => !busy.has(id));
  if (next === undefined) return;
  await client.from("agent_runs").insert({ agent_id: next, cause: "schedule" });
  console.log(`${new Date().toISOString()} backlog run for ${next}`);
}

export const say = (client: Db, thread: string, body: string) =>
  client.from("agent_messages").insert({
    thread,
    author_kind: "system",
    author_id: "system",
    author_name: "Matter of Place",
    body: body.slice(0, 20000),
  });

/** How a call of Matter's is recorded: decided by him (made on the next pass), or waiting for a decision. */
export function decision(
  decidedByMatter: boolean,
  now: Date,
): { state?: "approved"; decided_at?: string; reason?: string } {
  return decidedByMatter
    ? { state: "approved", decided_at: now.toISOString(), reason: "Decided by Matter" }
    : {};
}

/**
 * Gap item 31: each call Matter names is checked against the admin's routes and its key. From his live session he
 * decides it himself (operator, 2026-10-15: Matter runs the operation in his place), so it is recorded as approved and
 * the next pass makes it; from a read-only run, woken by outside text (H101), it waits in Approvals for a decision.
 */
export async function proposeCalls(
  client: Db,
  agent: { id: string },
  runId: string,
  thread: string,
  raw: readonly unknown[],
  decidedByMatter = false,
): Promise<void> {
  if (raw.length === 0) return;
  loadEnvFile();
  const key = process.env["MATTER_AGENT_KEY"];
  if (key === undefined || key === "") {
    await say(
      client,
      thread,
      "Matter asked to change the admin, but this laptop holds no Matter key.",
    );
    return;
  }
  const routes = adminRoutes();
  const allowed = await allowedActions(key);
  const lines: string[] = [];
  for (const item of raw.slice(0, MAX_CALLS)) {
    const check = checkCall(item, routes, allowed);
    if (!check.ok) {
      lines.push(`Not proposed: ${check.reason}.`);
      continue;
    }
    const proposal = callProposal(check);
    const { error } = await client.from("agent_approvals").insert({
      agent_id: agent.id,
      run_id: runId,
      ...proposal,
      content_hash: createHash("sha256").update(JSON.stringify(proposal.content)).digest("hex"),
      ...decision(decidedByMatter, new Date()),
    });
    lines.push(
      error !== null
        ? `Not proposed: ${error.message}`
        : decidedByMatter
          ? `Doing it now: ${proposal.summary}`
          : `Waiting for your approval: ${proposal.summary}`,
    );
  }
  if (raw.length > MAX_CALLS) {
    lines.push(
      `${String(raw.length - MAX_CALLS)} more were left out (at most ${String(MAX_CALLS)} a run).`,
    );
  }
  await say(client, thread, lines.join("\n"));
}

/** W8 0e: the power of the run that proposed a call (H101: full only for a run a signed-in person's line woke). */
export async function proposedAt(client: Db, runId: string | null): Promise<"full" | "read"> {
  if (runId === null) return "read";
  const { data: run } = await client
    .from("agent_runs")
    .select("agent_id, cause, message_id")
    .eq("id", runId)
    .maybeSingle();
  if (run?.message_id == null) return "read";
  // full power is Matter's alone (H101; third review): any other colleague's run proposes at read power
  const { data: agent } = await client
    .from("agents")
    .select("slug")
    .eq("id", run.agent_id)
    .maybeSingle();
  if (agent?.slug !== "matter") return "read";
  const { data: line } = await client
    .from("agent_messages")
    .select("author_kind")
    .eq("id", run.message_id)
    .maybeSingle();
  return matterPower(run.cause, line?.author_kind ?? null);
}

/** What an approved call comes to: refused for its address or as a team line nobody with power put there, or made. */
export async function approvedOutcome(
  client: Db,
  row: { decided_by: string | null; run_id: string | null },
  call: AdminCall,
  key: string,
  send: Send = fetch,
): Promise<CallOutcome> {
  // W9 item 1: a call that would mail an address the check refuses is not made.
  const refusal = await refusedAddress(call.body);
  if (refusal !== null)
    return { status: 0, ok: false, message: `not made, the address is refused: ${refusal}` };
  // W8 0e (second review): a line to the team wakes colleagues with a terminal, so only a person or Matter at full
  // power may have put it here.
  if (!teamLineAllowed(call, row.decided_by, await proposedAt(client, row.run_id)))
    return {
      status: 0,
      ok: false,
      message: "not made, a change that reaches a colleague needs a person's approval",
    };
  return makeCall(call, key, ADMIN_BASE, send);
}

/** Gap item 31: an approved call is made once with Matter's own key, and its outcome is written back and said. */
async function makeApprovedCalls(client: Db): Promise<void> {
  const { data } = await client
    .from("agent_approvals")
    .select("id, summary, content, decided_by, run_id")
    .eq("action", "admin_call")
    .eq("state", "approved")
    .is("content->outcome", null)
    .order("decided_at", { ascending: true })
    .limit(5);
  if (data === null || data.length === 0) return;
  loadEnvFile();
  const key = process.env["MATTER_AGENT_KEY"];
  if (key === undefined || key === "") return;
  for (const row of data) {
    const content = z.record(z.string(), z.unknown()).parse(row.content);
    const call = adminCallSchema.safeParse(content["call"]);
    // Marked first, so a pass that dies mid-call never makes it twice.
    await client
      .from("agent_approvals")
      .update({ content: { ...content, outcome: { state: "making" } } })
      .eq("id", row.id);
    const outcome = call.success
      ? await approvedOutcome(client, row, call.data, key)
      : { status: 0, ok: false, message: "the call could not be read" };
    await client
      .from("agent_approvals")
      .update({ content: { ...content, outcome: { ...outcome, at: new Date().toISOString() } } })
      .eq("id", row.id);
    await say(
      client,
      "matter",
      outcome.ok
        ? `Done: ${row.summary}`
        : `Could not do it: ${row.summary} (${String(outcome.status)} ${outcome.message})`,
    );
  }
}

async function pass(client: Db): Promise<void> {
  await beginPass(client);
  mkdirSync(HOME, { recursive: true });
  // W6 item 1: the staff policy follows the weekly allowance; a change is said once in the team thread.
  const { policy, changed, reading } = refreshPolicy();
  if (reading === null) {
    console.log(`${new Date().toISOString()} usage: unreadable`);
  } else {
    // W6 item 2: the Office's header reads this line (a vendor line: a settings write would bump the catalog).
    const { error } = await client.rpc("record_vendor_usage", {
      p_line: "claude_week",
      p_used: reading.weekPercent,
      p_limit: 100,
      p_note: reading.resetsAt.toISOString(),
    });
    if (error !== null) console.log(`${new Date().toISOString()} usage: not recorded`);
  }
  if (changed) await say(client, "team", policy.reason);
  const until = breakerUntil(BREAKER_FILE);
  if (until !== null) {
    console.log(
      `${new Date().toISOString()} paused: the Claude usage limit resets at ${until.toISOString()}`,
    );
    return;
  }
  // Gap audit item 6: between runs the runner moves to the newest main; the next pass runs the new code.
  const { data: running } = await client.from("agent_runs").select("worker").eq("state", "running");
  // A reel being made runs from this checkout, so the runner does not move under it (W7 item 19).
  const reelBusy = reelWorking();
  if (!runnerBusy(running ?? []) && !reelBusy) {
    const followed = followMain(resolve(import.meta.dir, "../.."), join(HOME, "runner-app"));
    if (followed !== "unchanged" && followed !== "not the runner") {
      console.log(`${new Date().toISOString()} runner ${followed}`);
    }
    // W6 item 3: a child process, so the map is drawn by the code the runner just moved to, not the code loaded here.
    if (mapDue(followed, existsSync(join(HOME, "matter", "system-map.md")))) {
      const made = spawnSync("bun", [join(import.meta.dir, "../matter/system-map.ts")], {
        cwd: resolve(import.meta.dir, "../.."),
        windowsHide: true,
        encoding: "utf8",
        timeout: 120_000,
      });
      console.log(
        `${new Date().toISOString()} ${made.status === 0 ? made.stdout.trim() : `system map failed: ${made.stderr.trim().slice(0, 300)}`}`,
      );
    }
  }
  // W7 item 19: the oldest queued reel is made by a process of its own, one at a time, so passes keep their minute. It
  // does not wait for colleague runs: Matter's live session is one and is nearly always running (P-3480). W8 0f: the same
  // pass uploads an approved draft, sends a waiting piece's preview and writes the rows of the studio.
  if (!reelBusy && reelWork()) {
    spawn("bun", [join(import.meta.dir, "reel.ts"), "--pass"], {
      cwd: resolve(import.meta.dir, "../.."),
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    }).unref();
    console.log(`${new Date().toISOString()} reel pass started`);
  }
  await makeApprovedCalls(client);
  // W4: replies to our email reach their colleague; W8 0h: every other message of every folder is recorded once and
  // reaches its owner or Matter. A mailbox that fails never stops the runs; a folder it could not read is named.
  const mail = await checkMail(client, HOME).catch((failure: unknown) => {
    console.log(failure instanceof Error ? failure.message : String(failure));
    return null;
  });
  if (mail !== null && mail.replies + mail.inbound + mail.unread.length > 0)
    console.log(
      `${new Date().toISOString()} mail: replies ${String(mail.replies)}, inbound ${String(mail.inbound)}${mail.unread.length === 0 ? "" : `, not read: ${mail.unread.join(", ")}`}`,
    );
  // W9 item 1: where port 25 opens, each new address is probed once and a refused one is never mailed.
  const refused = await checkNewAddresses(client, HOME).catch((failure: unknown) => {
    console.log(`email check: ${failure instanceof Error ? failure.message : String(failure)}`);
    return 0;
  });
  if (refused > 0) console.log(`${new Date().toISOString()} refused addresses ${String(refused)}`);
  // W5 item 13: our public pages' text in every desk, once a day, so a colleague can quote the site it works for.
  const { data: staff } = await client.from("agents").select("slug");
  const pages = await writeSitePages(
    // and in each work folder, the only place a terminal run may read (W8 0e, third review)
    (staff ?? []).flatMap(({ slug }) => [
      join(HOME, "desks", slug),
      join(HOME, "desks", slug, "work"),
    ]),
  ).catch((failure: unknown) => {
    console.log(`site pages: ${failure instanceof Error ? failure.message : String(failure)}`);
    return 0;
  });
  if (pages > 0) console.log(`${new Date().toISOString()} site pages ${String(pages)}`);
  // A wake that fails keeps its cursor and never stops the runs a person's line or an earlier event queued.
  const woke = await wakeOnEvents(client).catch((failure: unknown) => {
    console.log(failure instanceof Error ? failure.message : String(failure));
    return 0;
  });
  if (woke > 0) console.log(`${new Date().toISOString()} woke ${String(woke)}`);
  // Up to five runs a pass, one after another; the scheduled task starts the next pass a minute later.
  let ran = 0;
  for (let index = 0; index < 5; index += 1) {
    if (!(await runOnce(client))) break;
    ran += 1;
  }
  // W2 contract 12: with nothing waiting, one colleague works its open decisions (its backlog).
  // W6 item 1: only with the allowance under 70% (or an override) do colleagues start work of their own.
  if (ran === 0 && policy.backlog === "all") await wakeBacklog(client);
}

/**
 * The outside watchdog: a supervisor whose heartbeat is silent for 15 minutes is ended from here, because a process
 * blocked on one call cannot run its own timer and "MOP Matter Live" will not start a second copy (P-3703).
 */
function endStalledSupervisor(now: number = Date.now()): boolean {
  const pid = stalledSupervisorPid(undefined, undefined, now);
  if (pid === null) return false;
  const found = spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      `(Get-CimInstance Win32_Process -Filter 'ProcessId=${String(pid)}').CommandLine`,
    ],
    { encoding: "utf8", windowsHide: true, timeout: 30_000 },
  );
  if (!isSupervisorCommand(found.stdout)) return false;
  console.log(
    `${new Date(now).toISOString()} matter: live supervisor ${String(pid)} silent 15 minutes, ended from outside`,
  );
  spawnSync("taskkill", ["/T", "/F", "/PID", String(pid)], { windowsHide: true, timeout: 30_000 });
  return true;
}

async function main(): Promise<void> {
  endStalledSupervisor();
  const client = db();
  if (process.argv.includes("--loop")) {
    for (;;) {
      await pass(client).catch((error: unknown) => {
        console.log(error instanceof Error ? error.message : String(error));
      });
      await new Promise((settle) => setTimeout(settle, 15_000));
    }
  }
  await pass(client);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
