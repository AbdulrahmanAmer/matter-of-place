// W2 step 7 (contract 9 to 14): the team's daily meeting, written, templated and deciding. The "MOP Meeting" scheduled
// task runs it at 17:45 local time on the operator's laptop (Cairo, so 18:00 follows Egypt's clock changes):
//   bun scripts/workforce/meeting.ts          meet once today (a second start the same day does nothing)
//   bun scripts/workforce/meeting.ts --dry    print what it would post, write nothing
// 1. The Analyst posts the scorecard (eight numbers against last week, read by code) with at most three observations,
//    and the day's competitor changes; what it learned goes to the knowledge base.
// 2. Each colleague posts three lines: done (with one number), next, blocked on. No replies between agents.
// 3. Matter closes yesterday's decisions as done or missed, writes at most five new ones (owner, due date, the number
//    that proves it), may hire when a role is overloaded, says which upgrade comes next when a gauge nears its limit,
//    and sends the operator a ten-line digest in his side chat.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { hireInputSchema } from "../../src/domain/workforce.ts";
import type { Db } from "../../src/server/lib/db.ts";
import { askMatter, fenced, matterInputs } from "../matter/run.ts";
import { staffCharterFrom } from "./charter.ts";
import { breakerUntil, runClaude, UsageLimitError, type CliUsage } from "./cli.ts";
import { childEnv, serviceDb as client } from "./env.ts";
import { costMicroUsd, inputTokens } from "./growth.ts";
import { knowledgeBlock, remember } from "./knowledge.ts";
import { scorecard, scorecardText } from "./scorecard.ts";

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
const matterAnswer = z.object({
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

/** Today's date where the operator is (Cairo). */
export function cairoDate(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(now);
}

async function ask(
  prompt: string,
  model: string,
  research: boolean,
): Promise<{ text: string; usage?: CliUsage }> {
  const desk = join(HOME, "desks", "meeting");
  mkdirSync(desk, { recursive: true });
  return runClaude({
    args: [
      "-p",
      "--model",
      models[model] ?? "claude-sonnet-5-5",
      "--output-format",
      "json",
      "--strict-mcp-config",
      ...(research ? ["--allowedTools", "WebSearch"] : []),
    ],
    cwd: desk,
    env: childEnv(),
    prompt,
    timeoutMs: 8 * 60_000,
    who: "the meeting",
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

const VOICE =
  "House voice: calm, brief, specific; no em dashes, no hyperbole, no promises of buyers or sales.";

async function main(): Promise<void> {
  const dry = process.argv.includes("--dry");
  const now = new Date();
  const today = cairoDate(now);
  const marker = join(HOME, `meeting-${today}.done`);
  if (!dry && existsSync(marker)) {
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

  // 1. The Analyst.
  let analysis = "";
  if (analyst !== undefined) {
    const started = new Date().toISOString();
    const answer = await ask(
      [
        charter,
        `You are ${analyst.name}, ${analyst.role}, at Matter of Place. Your brief: ${analyst.instructions}`,
        VOICE,
        `Today's scorecard (the last seven days against the seven before, read from the database):\n${numbers}`,
        knowledgeBlock(`${numbers} competitors campaigns posts properties`),
        "Search the web for what changed today at editorial and luxury residential property platforms and media that compete for the same owners, agents and readers in California, New York and Florida.",
        'Answer with one JSON object and nothing else: {"observations": ["at most three, each tied to a number above"], "competitors": "a short list of what changed today, or that nothing did", "knowledge": [{"subject": "competitors|posts|properties|campaigns|audience", "text": "one thing worth remembering"}]}',
      ]
        .filter((part) => part !== "")
        .join("\n\n"),
      analyst.model,
      analyst.tools.includes("research"),
    );
    const result = lastJson(answer.text, analystAnswer);
    analysis = [
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
    await post(
      db,
      dry,
      "team",
      { slug: analyst.slug, name: analyst.name, kind: "agent" },
      analysis,
    );
    if (!dry)
      remember([
        ...result.knowledge,
        ...(result.competitors === ""
          ? []
          : [{ subject: "competitors", text: result.competitors }]),
      ]);
    await record(db, dry, analyst, "The meeting's scorecard", answer.usage, started);
  } else {
    analysis = `Scorecard for ${today}:\n${numbers}`;
    await post(db, dry, "team", { slug: "system", name: SYSTEM, kind: "system" }, analysis);
  }

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
    const { data: runs } = await db
      .from("agent_runs")
      .select("summary, state, finished_at")
      .eq("agent_id", agent.id)
      .gte("created_at", new Date(now.getTime() - 24 * 3_600_000).toISOString())
      .order("created_at", { ascending: false })
      .limit(10);
    const mine = (open ?? []).filter((item) => item.owner_id === agent.id);
    const started = new Date().toISOString();
    const answer = await ask(
      [
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
        .join("\n\n"),
      agent.model,
      false,
    );
    const said = lastJson(answer.text, lineAnswer);
    const body = `Done: ${said.done || "nothing to report"}\nNext: ${said.next || "nothing planned"}\nBlocked on: ${said.blocked || "nothing"}`;
    lines.push(`@${agent.slug}: ${body.replaceAll("\n", " · ")}`);
    await post(db, dry, "team", { slug: agent.slug, name: agent.name, kind: "agent" }, body);
    await record(db, dry, agent, "The meeting's three lines", answer.usage, started);
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
  const started = new Date().toISOString();
  const inputs = matterInputs(PLAN);
  const answer = await askMatter(
    [
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
      `Decide. Answer with one JSON object and nothing else: {"closed": [{"id": "decision id", "status": "done|missed"}], "decisions": [{"owner": "colleague handle without @", "decision": "what", "due_on": "YYYY-MM-DD, ${today} or later", "metric": "the number that proves it"}], "digest": "at most ten lines for the operator: what moved, what was decided, and in one block everything that needs him", "knowledge": [{"subject": "...", "text": "..."}], "hire": []}. At most five decisions.`,
    ]
      .filter((part) => part !== "")
      .join("\n\n"),
    childEnv(),
  );
  const decided = lastJson(answer.text, matterAnswer);
  const handles = active.map((agent) => agent.slug);
  const kept = keptDecisions(decided.decisions, handles, today);
  const idOf = new Map(agents.map((agent) => [agent.slug, agent.id]));
  if (!dry) {
    for (const item of decided.closed) {
      if (!(open ?? []).some((row) => row.id === item.id)) continue;
      await db
        .from("agent_decisions")
        .update({ status: item.status, checked_at: new Date().toISOString() })
        .eq("id", item.id);
    }
    if (kept.length > 0)
      await db.from("agent_decisions").insert(
        kept.map((item) => ({
          meeting_on: today,
          owner_id: idOf.get(item.owner) ?? matter.id,
          decision: item.decision,
          due_on: item.due_on,
          metric: item.metric,
        })),
      );
    remember(decided.knowledge);
    for (const hire of decided.hire) {
      const { error: hireError } = await db.from("agents").insert(hire);
      if (hireError === null)
        await post(
          db,
          dry,
          "team",
          { slug: "system", name: SYSTEM, kind: "system" },
          `${hire.name} joined the team as ${hire.role}.`,
        );
    }
  }
  const closedLine =
    decided.closed.length === 0
      ? ""
      : `Yesterday: ${decided.closed.map((item) => item.status).join(", ")}.\n`;
  await post(
    db,
    dry,
    "team",
    { slug: "matter", name: "Matter", kind: "agent" },
    `${closedLine}Decisions for ${today}:\n${kept.length === 0 ? "No new decision." : kept.map((item, index) => `${String(index + 1)}. @${item.owner}: ${item.decision} (due ${item.due_on}; proven by ${item.metric})`).join("\n")}`,
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
  if (!dry) writeFileSync(marker, now.toISOString());
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
