// W1 step 4: the workforce daemon, run with bun on the operator's laptop by a hidden scheduled task
// (scripts/workforce/install.ps1). Each pass it (1) wakes colleagues whose `wake_on` lists a new event, (2) claims one
// queued run with `claim_agent_run`, (3) asks the operator's signed-in Claude CLI for the colleague's answer with the
// prompt on stdin, and (4) writes the reply, any proposals for approval and any hire the chief of staff made.
// No model key exists anywhere (H34): the CLI is the operator's own account. It prints no secret and no prompt.
//   bun scripts/workforce/daemon.ts          one pass, then exit (the scheduled task runs it every minute)
//   bun scripts/workforce/daemon.ts --loop   pass after pass until stopped (for watching it live)
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { join, resolve } from "node:path";
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
} from "../matter/actions.ts";
import { askMatter, keepNote, matterInputs, matterPower, matterPrompt } from "../matter/run.ts";
import { staffCharterFrom } from "./charter.ts";
import { childEnv, loadEnvFile, serviceDb as db } from "./env.ts";
import { knowledgeBlock } from "./knowledge.ts";
import { readSiteFacts, writeSitePages } from "./site-facts.ts";
import { makeVoiceover } from "./media.ts";
import { nextReel, queueReel, reelWorking } from "./reel.ts";
import { breakerUntil, runClaude, UsageLimitError, type CliUsage } from "./cli.ts";
import { costMicroUsd, inputTokens, lessonsBlock, recallLessons, type Lesson } from "./growth.ts";
import { followMain, mapDue } from "./follow.ts";
import { readJsonAnswer } from "./answer.ts";
import {
  answerable,
  HELD_AUTHOR,
  heldLine,
  ownsOutside,
  ruleOutside,
  shownBody,
  triageArgs,
  triageLines,
  triageRun,
} from "./triage.ts";
import { groundingLines, requestSequence } from "./grounding.ts";
import { colleagueCalls, colleagueRoutes } from "./colleague-calls.ts";
import { applyHires } from "./hiring.ts";
import { checkMail } from "./mail.ts";
import { bounceFacts, wakes } from "./bounce.ts";
import { checkNewAddresses, refusedAddress } from "./email-check.ts";
import { refreshPolicy, staffPolicy } from "./config.ts";
import { underCeiling } from "./usage-policy.ts";
import { liveAlive } from "../matter/live-alive.ts";

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

function askClaude(
  prompt: string,
  model: string,
  cwd: string,
  research = false,
): Promise<{ text: string; session?: string; usage?: CliUsage }> {
  return runClaude({
    args: [
      "-p",
      "--model",
      model,
      "--output-format",
      "stream-json",
      "--verbose",
      "--strict-mcp-config",
      "--mcp-config",
      emptyMcpConfig(),
      // H101: no shell, no web fetch, none of the operator's own settings, files only inside the desk; anything
      // not allowed is refused, never asked.
      "--restricted",
      "--permission-mode",
      "dontAsk",
      // W2 step 7: a colleague with the research tool may search the web, and nothing more.
      ...(research ? ["--allowedTools", "WebSearch"] : []),
    ],
    cwd,
    env: childEnv(),
    prompt,
    idleMs: CLI_IDLE_MS,
    who: "the colleague",
  });
}

// ---------- waking on events ----------

function readCursor(): string {
  try {
    const value: unknown = JSON.parse(readFileSync(CURSOR_FILE, "utf8"));
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

async function wakeOnEvents(client: Db): Promise<number> {
  const cursor = readCursor();
  const { data: events, error } = await client
    .from("events")
    .select("id, type, at, entity")
    .gt("at", cursor)
    .order("at")
    .limit(50);
  if (error !== null) throw new Error("workforce: the events could not be read");
  if (events.length === 0) {
    writeFileSync(CURSOR_FILE, JSON.stringify({ at: cursor }));
    return 0;
  }
  const { data: agents } = await client.from("agents").select("id, wake_on, state");
  const rows = events.flatMap((event) =>
    (agents ?? [])
      // W9 item 3: a bounce wakes only the owner of the request or inquiry it is about.
      .filter((agent) => wakes(agent, event))
      .map((agent) => ({ agent_id: agent.id, cause: "event", event_id: event.id })),
  );
  if (rows.length > 0) {
    await client
      .from("agent_runs")
      .upsert(rows, { onConflict: "agent_id,event_id", ignoreDuplicates: true });
  }
  writeFileSync(CURSOR_FILE, JSON.stringify({ at: events.at(-1)?.at ?? cursor }));
  return rows.length;
}

// ---------- one run ----------

const allowedProposal: Record<string, string> = {
  reply_inquiry: "draft_reply",
  social_post: "draft_post",
  newsletter_issue: "draft_newsletter",
  campaign_plan: "draft_campaign",
};

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
) {
  const parts: string[] = [];
  let event: { type: string; entity_id: string | null } | null = null;
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
      `What woke you: the event ${data.type} at ${data.at}.\nIts data: ${JSON.stringify(data.payload)}`,
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
          .then(({ data }) => data?.[0] ?? null),
    client
      .from("agent_approvals")
      .select("action, summary, created_at")
      .eq("agent_id", run.agent_id)
      .eq("state", "pending")
      .order("created_at")
      .then(({ data }) => data ?? []),
  ]);
  // W8 0b: an outside message reaches the prompt only as its triage; its text stays in the database for a person.
  const triage = await triageRun(client, ask, event, woke);
  if (triage !== null) parts.push(...triageLines(triage));
  const wokeShown =
    woke === null
      ? null
      : matterReadsHeld && woke.author_id === HELD_AUTHOR
        ? woke
        : { ...woke, body: shownBody(woke) };
  parts.push(...groundingLines(wokeShown, pending));
  const { data: messages } = await client
    .from("agent_messages")
    .select("author_id, author_name, body, created_at")
    .eq("thread", thread)
    .order("created_at", { ascending: false })
    .limit(HISTORY);
  if (messages !== null && messages.length > 0) {
    parts.push(
      `The conversation so far (${thread === "team" ? "the team chat" : "your direct thread"}, oldest first):\n` +
        messages
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
  // W5 item 13: our own products, prices and markets, so no reply brackets a price it could have read.
  parts.push(await readSiteFacts());
  return { situation: parts.join("\n\n"), triage };
}

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
    situation,
    'Answer with one JSON object and nothing else: {"reply": "what you say in the conversation, short", "task": "a few words for the office board on what you did", "proposals": [{"action": "reply_inquiry|social_post|newsletter_issue|campaign_plan", "summary": "one line", "content": {"body": "the full text", "to": "who it is for if any"}}], "hire": [{"slug": "handle", "name": "Name", "role": "what they do", "instructions": "their brief", "model": "sonnet", "wake_on": [], "tools": ["read_business", "chat"]}]}. Leave proposals and hire empty unless they are needed and you may do them.',
  ].join("\n\n");
}

async function runOnce(client: Db): Promise<boolean> {
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
    thread = message?.thread ?? "team";
    authorKind = message?.author_kind ?? null;
    wokeBy = message?.author_id ?? null;
  }
  await client
    .from("agents")
    .update({ state: "working", current_task: "Reading", last_seen_at: new Date().toISOString() })
    .eq("id", agent.id);

  const cwd = join(HOME, "desks", agent.slug);
  mkdirSync(cwd, { recursive: true });
  try {
    const matterReadsHeld = agent.slug === "matter" && wokeBy === HELD_AUTHOR;
    const { situation, triage } = await context(client, run, thread, askTriage, matterReadsHeld);
    // W8 0a/0d: an outside message is answered by its owner only; anyone else it woke does nothing with it.
    if (triage !== null && !ownsOutside(triage, agent.slug)) {
      await client
        .from("agent_runs")
        .update({
          state: "done",
          finished_at: new Date().toISOString(),
          summary: "Not its owner (W8 0a)",
        })
        .eq("id", run.id);
      return true;
    }
    // W8 0d: a message outside its criteria, or one that tries to direct the AI, wakes no one to answer it: it is held
    // in the owner's thread for Matter, who reads it without power and decides. The run ends here, before any prompt.
    // Every other reader of that thread sees the held line only as a placeholder (shownBody).
    if (triage !== null && !answerable(triage)) {
      const { data: heldRows, error: heldError } = await client
        .from("agent_messages")
        .insert({
          thread: agent.slug,
          author_kind: "system",
          author_id: HELD_AUTHOR,
          author_name: "Triage",
          body: heldLine(triage, agent.slug),
        })
        .select("id");
      const held = heldRows?.[0];
      // A hold that cannot be written fails the run, so the message is never dropped in silence.
      if (heldError !== null || held === undefined)
        throw new Error("the held line could not be written");
      const matterRow = (agents ?? []).find((row) => row.slug === "matter");
      if (matterRow !== undefined) {
        await client
          .from("agent_runs")
          .insert({ agent_id: matterRow.id, cause: "message", message_id: held.id });
      }
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
    // H101: only a signed-in person's message gives Matter full power, keeps its notes and lets it hire directly.
    const power = isMatter ? matterPower(run.cause, authorKind) : "read";
    const answer = isMatter
      ? await askMatter(
          matterPrompt({
            ...matterInputs(resolve(import.meta.dir, "../../../workspace/05-plans/W2.md")),
            thread: situation,
            business: lessons,
            power,
          }),
          matterEnv(),
          power,
        )
      : await askClaude(
          promptFor(
            // W8 0c: a run about an outside message is not offered admin calls or hires at all.
            triage === null
              ? agent
              : {
                  ...agent,
                  tools: agent.tools.filter((tool) => tool !== "admin_call" && tool !== "hire"),
                },
            team,
            situation,
            lessons,
            staffCharterFrom(resolve(import.meta.dir, "../../../workspace/05-plans/W2.md")),
            knowledgeBlock(situation),
          ),
          models[underCeiling(agent.model, policy.colleagueCeiling)] ??
            models["sonnet"] ??
            "claude-sonnet-5-5",
          cwd,
          agent.tools.includes("research"),
        );
    // W8 0c: a run about an outside message keeps only the proposals its source allows: no admin call, no hire, no
    // media, no colleague woken by a mention. What it drops is said in the thread.
    const ruled = ruleOutside(readJsonAnswer(answer.text), triage);
    const result = ruled.kept;
    if (ruled.dropped.length > 0 && triage !== null) {
      await say(
        client,
        thread,
        `Not proposed: ${ruled.dropped.join(", ")}; not allowed for ${triage.source} (W8 0c).`,
      );
    }
    if (isMatter && power === "full") keepNote(result.note);
    // W2 step 5: Matter cannot run a skill in its safe mode; the daemon runs it, one at a time, and says where it is.
    // Only at full power (W8 review): a read run, woken by outside text, asks for no media.
    const media = isMatter && power === "full" ? result.media.slice(0, 2) : [];

    if (result.reply !== "") {
      await client.from("agent_messages").insert({
        thread,
        author_kind: "agent",
        author_id: agent.slug,
        author_name: agent.name,
        body: result.reply.slice(0, 20000),
      });
      // A colleague handing work to another wakes them, once.
      const handed = mentionedSlugs(result.reply).filter((slug) => slug !== agent.slug);
      const targets = (agents ?? []).filter(
        (row) => handed.includes(row.slug) && row.state !== "off" && row.state !== "paused",
      );
      if (targets.length > 0 && run.cause !== "message" && ruled.wakeMentioned) {
        const { data: last } = await client
          .from("agent_messages")
          .select("id")
          .eq("thread", thread)
          .order("created_at", { ascending: false })
          .limit(1)
          .single();
        if (last !== null)
          await client
            .from("agent_runs")
            .insert(
              targets.map((row) => ({ agent_id: row.id, cause: "message", message_id: last.id })),
            );
      }
    }
    for (const request of media) {
      if (request.skill === "reel") {
        // W7 item 19: a reel takes many minutes, so it waits in the studio for the reel pass, never inside a run.
        const folder = queueReel(request, { agent: agent.slug, thread });
        await say(client, thread, `The reel "${request.name}" is queued in the studio: ${folder}`);
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
    for (const proposal of result.proposals) {
      if (!agent.tools.includes(allowedProposal[proposal.action] ?? "")) continue;
      const content = proposal.content;
      await client.from("agent_approvals").insert({
        agent_id: agent.id,
        run_id: run.id,
        action: proposal.action,
        summary: proposal.summary,
        content,
        content_hash: createHash("sha256").update(JSON.stringify(proposal.content)).digest("hex"),
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
    await client
      .from("agent_runs")
      .update({
        state: "done",
        finished_at: new Date().toISOString(),
        // W8 review: Matter's read of a held line is summed up in fixed words; its own words could carry the outside
        // text into the live session's digest.
        summary: matterReadsHeld
          ? "Read an outside message held for Matter"
          : (result.task || result.reply).slice(0, 300),
        session_id:
          "session" in answer && typeof answer.session === "string" ? answer.session : null,
        turns: 1,
        lessons_used: shown.map((lesson) => lesson.id),
        ...(answer.usage === undefined
          ? {}
          : {
              input_tokens: inputTokens(answer.usage),
              output_tokens: answer.usage.output_tokens,
              cost_microusd: costMicroUsd(agent.model, answer.usage),
            }),
      })
      .eq("id", run.id);
    // A lesson shown is a lesson used: its count ranks it, and the weekly review promotes the ones used often.
    const now = new Date().toISOString();
    for (const lesson of shown) {
      await client
        .from("agent_lessons")
        .update({ uses: lesson.uses + 1, last_used_at: now })
        .eq("id", lesson.id);
    }
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

/** Gap item 31: an approved call is made once with Matter's own key, and its outcome is written back and said. */
async function makeApprovedCalls(client: Db): Promise<void> {
  const { data } = await client
    .from("agent_approvals")
    .select("id, summary, content")
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
    // W9 item 1: a call that would mail an address the check refuses is not made.
    const refusal = call.success ? await refusedAddress(call.data.body) : null;
    const outcome = !call.success
      ? { status: 0, ok: false, message: "the call could not be read" }
      : refusal !== null
        ? { status: 0, ok: false, message: `not made, the address is refused: ${refusal}` }
        : await makeCall(call.data, key, ADMIN_BASE);
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
  // W2: Matter's side chat says "online" while this runner passes; one touch of Matter's row per pass.
  await client
    .from("agents")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("slug", "matter")
    .neq("state", "working");
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
  const { count: inFlight } = await client
    .from("agent_runs")
    .select("id", { count: "exact", head: true })
    .eq("state", "running");
  // A reel being made runs from this checkout, so the runner does not move under it (W7 item 19).
  const reelBusy = reelWorking();
  if (inFlight === 0 && !reelBusy) {
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
  // does not wait for colleague runs: Matter's live session is one and is nearly always running (P-3480).
  if (!reelBusy && nextReel() !== null) {
    spawn("bun", [join(import.meta.dir, "reel.ts"), "--pass"], {
      cwd: resolve(import.meta.dir, "../.."),
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    }).unref();
    console.log(`${new Date().toISOString()} reel pass started`);
  }
  await makeApprovedCalls(client);
  // W4: replies to our email reach their colleague; a mailbox that fails never stops the runs.
  const replies = await checkMail(client, HOME).catch((failure: unknown) => {
    console.log(failure instanceof Error ? failure.message : String(failure));
    return 0;
  });
  if (replies > 0) console.log(`${new Date().toISOString()} replies ${String(replies)}`);
  // W9 item 1: where port 25 opens, each new address is probed once and a refused one is never mailed.
  const refused = await checkNewAddresses(client, HOME).catch((failure: unknown) => {
    console.log(`email check: ${failure instanceof Error ? failure.message : String(failure)}`);
    return 0;
  });
  if (refused > 0) console.log(`${new Date().toISOString()} refused addresses ${String(refused)}`);
  // W5 item 13: our public pages' text in every desk, once a day, so a colleague can quote the site it works for.
  const { data: staff } = await client.from("agents").select("slug");
  const pages = await writeSitePages(
    (staff ?? []).map(({ slug }) => join(HOME, "desks", slug)),
  ).catch((failure: unknown) => {
    console.log(`site pages: ${failure instanceof Error ? failure.message : String(failure)}`);
    return 0;
  });
  if (pages > 0) console.log(`${new Date().toISOString()} site pages ${String(pages)}`);
  const woke = await wakeOnEvents(client);
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

async function main(): Promise<void> {
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
