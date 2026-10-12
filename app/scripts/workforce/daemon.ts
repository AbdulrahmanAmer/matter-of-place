// W1 step 4: the workforce daemon, run with bun on the operator's laptop by a hidden scheduled task
// (scripts/workforce/install.ps1). Each pass it (1) wakes colleagues whose `wake_on` lists a new event, (2) claims one
// queued run with `claim_agent_run`, (3) asks the operator's signed-in Claude CLI for the colleague's answer with the
// prompt on stdin, and (4) writes the reply, any proposals for approval and any hire the chief of staff made.
// No model key exists anywhere (H34): the CLI is the operator's own account. It prints no secret and no prompt.
//   bun scripts/workforce/daemon.ts          one pass, then exit (the scheduled task runs it every minute)
//   bun scripts/workforce/daemon.ts --loop   pass after pass until stopped (for watching it live)
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { join, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "../../src/db/index.ts";
import { agentTools, hireInputSchema, mentionedSlugs } from "../../src/domain/workforce.ts";
import type { Db } from "../../src/server/lib/db.ts";
import { askMatter, keepNote, matterInputs, matterPrompt } from "../matter/run.ts";
import { runClaude } from "./cli.ts";

const HOME = join(homedir(), ".mop-workforce");
const CURSOR_FILE = join(HOME, "cursor.json");
const WORKER = `${hostname()}:${String(process.pid)}`;
const CLI_TIMEOUT_MS = 6 * 60_000;
const RUNS_PER_HOUR = 40;
const HISTORY = 24;
const models: Record<string, string> = {
  opus: "claude-opus-5-5",
  sonnet: "claude-sonnet-5-5",
  haiku: "claude-haiku-5-5",
};

// ---------- the database ----------

function loadEnvFile(): void {
  const file = resolve(import.meta.dir, "../../../.env");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (match === null) continue;
    const [, name = "", raw = ""] = match;
    if (
      ![
        "DEV_SUPABASE_PROJECT_REF",
        "DEV_SUPABASE_SERVICE_ROLE_KEY",
        "WORKFORCE_CLI",
        "MATTER_AGENT_KEY",
      ].includes(name)
    )
      continue;
    if (process.env[name] === undefined) process.env[name] = raw.replace(/^"(.*)"$/, "$1");
  }
}

function db(): Db {
  loadEnvFile();
  const ref = process.env["DEV_SUPABASE_PROJECT_REF"];
  const key = process.env["DEV_SUPABASE_SERVICE_ROLE_KEY"];
  if (ref === undefined || key === undefined)
    throw new Error("workforce: the .env names of the project are missing");
  return createClient<Database>(`https://${ref}.supabase.co`, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// ---------- the CLI (Jay's lessons: stdin, no inherited CLAUDE* variables, no MCP, tree kill) ----------

function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (name.startsWith("CLAUDE") || name.startsWith("DEV_SUPABASE") || name.includes("SECRET"))
      continue;
    if (name.endsWith("_KEY") || name.endsWith("_TOKEN")) continue;
    env[name] = value;
  }
  return env;
}

/** Matter's environment: the employees' one plus its own admin key, which only Matter's tools may use (W2). */
function matterEnv(): NodeJS.ProcessEnv {
  const key = process.env["MATTER_AGENT_KEY"];
  return key === undefined ? childEnv() : { ...childEnv(), MATTER_AGENT_KEY: key };
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
): Promise<{ text: string; session?: string }> {
  return runClaude({
    args: [
      "-p",
      "--model",
      model,
      "--output-format",
      "json",
      "--strict-mcp-config",
      "--mcp-config",
      emptyMcpConfig(),
    ],
    cwd,
    env: childEnv(),
    prompt,
    timeoutMs: CLI_TIMEOUT_MS,
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
    .select("id, type, at")
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
      .filter(
        (agent) =>
          agent.state !== "off" && agent.state !== "paused" && agent.wake_on.includes(event.type),
      )
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

const outcome = z.object({
  reply: z.string().default(""),
  task: z.string().default(""),
  proposals: z
    .array(
      z.object({
        action: z.enum(["reply_inquiry", "social_post", "newsletter_issue"]),
        summary: z.string().min(1).max(500),
        content: z.object({
          body: z.string().min(1).max(20000),
          to: z.string().max(300).optional(),
        }),
      }),
    )
    .default([]),
  hire: z.array(hireInputSchema).default([]),
  // Matter only: one line it keeps in its capped notes.
  note: z.string().default(""),
});

const allowedProposal: Record<string, string> = {
  reply_inquiry: "draft_reply",
  social_post: "draft_post",
  newsletter_issue: "draft_newsletter",
};

function readJsonAnswer(text: string): z.infer<typeof outcome> {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return outcome.parse(JSON.parse(text.slice(start, end + 1)));
    } catch {
      // fall through: a plain answer is still a reply
    }
  }
  return { reply: text.trim(), task: "", proposals: [], hire: [], note: "" };
}

async function context(
  client: Db,
  run: { cause: string; event_id: string | null; message_id: string | null },
  thread: string,
) {
  const parts: string[] = [];
  if (run.event_id !== null) {
    const { data } = await client
      .from("events")
      .select("type, payload, at")
      .eq("id", run.event_id)
      .single();
    if (data !== null)
      parts.push(
        `What woke you: the event ${data.type} at ${data.at}.\nIts data: ${JSON.stringify(data.payload)}`,
      );
  }
  const { data: messages } = await client
    .from("agent_messages")
    .select("author_name, body, created_at")
    .eq("thread", thread)
    .order("created_at", { ascending: false })
    .limit(HISTORY);
  if (messages !== null && messages.length > 0) {
    parts.push(
      `The conversation so far (${thread === "team" ? "the team chat" : "your direct thread"}, oldest first):\n` +
        messages
          .reverse()
          .map((message) => `${message.author_name}: ${message.body}`)
          .join("\n"),
    );
  }
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
  return parts.join("\n\n");
}

function promptFor(
  agent: { name: string; slug: string; role: string; instructions: string; tools: string[] },
  team: { name: string; slug: string; role: string }[],
  situation: string,
): string {
  const may = agentTools.filter((tool) => agent.tools.includes(tool));
  return [
    `You are ${agent.name} (@${agent.slug}), ${agent.role}, at Matter of Place: a selective editorial and distribution platform for exceptional existing residential property in California, New York and Florida, a product of Omnikom LLC.`,
    "House voice for everything you write: calm, brief, specific; no em dashes, no hyperbole, no guarantees of buyers, leads or sales; price never equals merit.",
    `Your brief: ${agent.instructions}`,
    `Your colleagues: ${team.map((member) => `@${member.slug} (${member.name}, ${member.role})`).join("; ")}. Mention a colleague with @handle to hand them work.`,
    `You may: ${may.join(", ")}. Anything that leaves the company (a reply, a post, a newsletter) is a proposal a person approves; you never send it yourself.`,
    situation,
    'Answer with one JSON object and nothing else: {"reply": "what you say in the conversation, short", "task": "a few words for the office board on what you did", "proposals": [{"action": "reply_inquiry|social_post|newsletter_issue", "summary": "one line", "content": {"body": "the full text", "to": "who it is for if any"}}], "hire": [{"slug": "handle", "name": "Name", "role": "what they do", "instructions": "their brief", "model": "sonnet", "wake_on": [], "tools": ["read_business", "chat"]}]}. Leave proposals and hire empty unless they are needed and you may do them.',
  ].join("\n\n");
}

async function runOnce(client: Db): Promise<boolean> {
  const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
  const { count } = await client
    .from("agent_runs")
    .select("id", { count: "exact", head: true })
    .gte("started_at", hourAgo);
  if ((count ?? 0) >= RUNS_PER_HOUR) return false;

  const { data: claimed, error } = await client.rpc("claim_agent_run", {
    p_worker: WORKER,
    p_lease_seconds: 600,
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
  if (run.message_id !== null) {
    const { data: message } = await client
      .from("agent_messages")
      .select("thread")
      .eq("id", run.message_id)
      .single();
    thread = message?.thread ?? "team";
  }
  await client
    .from("agents")
    .update({ state: "working", current_task: "Reading", last_seen_at: new Date().toISOString() })
    .eq("id", agent.id);

  const cwd = join(HOME, "desks", agent.slug);
  mkdirSync(cwd, { recursive: true });
  try {
    const situation = await context(client, run, thread);
    const team = (agents ?? [])
      .filter((row) => row.id !== agent.id)
      .map(({ name, slug, role }) => ({ name, slug, role }));
    const isMatter = agent.slug === "matter";
    const answer = isMatter
      ? {
          text: await askMatter(
            matterPrompt({
              ...matterInputs(resolve(import.meta.dir, "../../../workspace/05-plans/W2.md")),
              thread: situation,
              business: "",
            }),
            matterEnv(),
          ),
        }
      : await askClaude(
          promptFor(agent, team, situation),
          models[agent.model] ?? models["sonnet"] ?? "claude-sonnet-5-5",
          cwd,
        );
    const result = readJsonAnswer(answer.text);
    if (isMatter) keepNote(result.note);

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
      if (targets.length > 0 && run.cause !== "message") {
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
      for (const hire of result.hire) {
        const { error: hireError } = await client.from("agents").insert(hire);
        if (hireError === null) {
          await client.from("agent_messages").insert({
            thread: "team",
            author_kind: "system",
            author_id: "system",
            author_name: "Matter of Place",
            body: `${hire.name} joined the team as ${hire.role}.`,
          });
        }
      }
    }
    await client
      .from("agent_runs")
      .update({
        state: "done",
        finished_at: new Date().toISOString(),
        summary: (result.task || result.reply).slice(0, 300),
        session_id: "session" in answer ? (answer.session ?? null) : null,
        turns: 1,
      })
      .eq("id", run.id);
    console.log(`${new Date().toISOString()} ${agent.slug} done`);
  } catch (failure) {
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

async function pass(client: Db): Promise<void> {
  // W2: Matter's side chat says "online" while this runner passes; one touch of Matter's row per pass.
  await client
    .from("agents")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("slug", "matter")
    .neq("state", "working");
  mkdirSync(HOME, { recursive: true });
  const woke = await wakeOnEvents(client);
  if (woke > 0) console.log(`${new Date().toISOString()} woke ${String(woke)}`);
  // Up to five runs a pass, one after another; the scheduled task starts the next pass a minute later.
  for (let index = 0; index < 5; index += 1) {
    if (!(await runOnce(client))) break;
  }
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
