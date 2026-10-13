import {
  wakeTargets,
  type Agent,
  type AgentApproval,
  type AgentMessage,
  type HireInput,
  type Office,
} from "../../domain/workforce.ts";
import { z } from "zod";
import { scoreSchema, type agentUpdateSchema } from "../../domain/workforce.ts";
import { fromRpcError } from "../lib/admin-errors.ts";
import type { AdminActor } from "../lib/admin-route.ts";
import { auditContext } from "../lib/audit.ts";
import { authorize } from "../lib/authz.ts";
import type { Db } from "../lib/db.ts";
import { AppError } from "../lib/errors.ts";

// W1: the admin side of the AI employees. The laptop daemon (scripts/workforce/daemon.ts) does the work; this file
// lists, hires, changes and talks to them, and records the decisions of people on their proposals. Reads go to the
// tables; every write is a SQL function (G43): workforce_post_message, workforce_hire, workforce_update_agent and
// workforce_decide, each writing its own audit row.

const unavailable = (what: string) =>
  new AppError("unavailable", undefined, `${what} could not be read.`);

/** The name a person shows in the chat: the part of their address before the @, with a capital. */
async function personName(db: Db, actor: AdminActor): Promise<string> {
  if (actor.kind !== "human") return "Agent key";
  const { data } = await db.auth.admin.getUserById(actor.userId);
  const local = data.user?.email?.split("@")[0] ?? "";
  return local === "" ? "Staff" : local.charAt(0).toUpperCase() + local.slice(1);
}

export async function getOffice(actor: AdminActor, db: Db): Promise<Office> {
  authorize(actor, "workforce.office");
  const since = new Date(Date.now() - 24 * 3_600_000).toISOString();
  const weekAgo = new Date(Date.now() - 7 * 24 * 3_600_000).toISOString();
  const [agents, runs, today, approvals, week] = await Promise.all([
    db.from("agents").select("*").order("created_at"),
    db
      .from("agent_runs")
      .select("id, agent_id, cause, state, summary, error, created_at, finished_at")
      .order("created_at", { ascending: false })
      .limit(30),
    db.from("agent_runs").select("agent_id").gte("created_at", since),
    db.from("agent_approvals").select("id", { count: "exact", head: true }).eq("state", "pending"),
    db.rpc("workforce_scoreboard", { p_since: weekAgo }),
  ]);
  if (
    agents.error !== null ||
    runs.error !== null ||
    today.error !== null ||
    approvals.error !== null ||
    week.error !== null
  ) {
    throw unavailable("The office");
  }
  const counts = new Map<string, number>();
  for (const row of today.data) counts.set(row.agent_id, (counts.get(row.agent_id) ?? 0) + 1);
  const slugOf = new Map(agents.data.map((row) => [row.id, row.slug]));
  return {
    agents: agents.data.map((row): Agent => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      role: row.role,
      instructions: row.instructions,
      model: row.model === "opus" || row.model === "haiku" ? row.model : "sonnet",
      wake_on: row.wake_on,
      tools: row.tools,
      state:
        row.state === "working" || row.state === "paused" || row.state === "off"
          ? row.state
          : "idle",
      current_task: row.current_task,
      last_seen_at: row.last_seen_at,
      created_at: row.created_at,
      runs_today: counts.get(row.id) ?? 0,
    })),
    runs: runs.data.map((row) => ({
      id: row.id,
      agent_slug: slugOf.get(row.agent_id) ?? "",
      cause: row.cause === "event" || row.cause === "schedule" ? row.cause : "message",
      state:
        row.state === "running" || row.state === "done" || row.state === "failed"
          ? row.state
          : "queued",
      summary: row.summary,
      error: row.error,
      created_at: row.created_at,
      finished_at: row.finished_at,
    })),
    pending_approvals: approvals.count ?? 0,
    week: z.array(scoreSchema).safeParse(week.data).data ?? [],
  };
}

export async function listMessages(
  actor: AdminActor,
  db: Db,
  thread: string,
): Promise<{ items: AgentMessage[] }> {
  authorize(actor, "workforce.messages");
  const { data, error } = await db
    .from("agent_messages")
    .select("id, thread, author_kind, author_id, author_name, body, created_at")
    .eq("thread", thread)
    .order("created_at", { ascending: false })
    .limit(80);
  if (error !== null) throw unavailable("The conversation");
  const kindOf = (value: string): AgentMessage["author_kind"] =>
    value === "agent" ? "agent" : value === "system" ? "system" : "human";
  return {
    items: data.map((row) => ({ ...row, author_kind: kindOf(row.author_kind) })).reverse(),
  };
}

/** Posts a person's message and wakes who it is for: the @mentioned, the employee of a direct thread, or the chief. */
export async function postMessage(
  actor: AdminActor,
  db: Db,
  input: { thread: string; body: string },
): Promise<{ id: string; woke: string[] }> {
  authorize(actor, "workforce.post_message");
  const { data: agents, error: agentsError } = await db.from("agents").select("id, slug, state");
  if (agentsError !== null) throw unavailable("The team");
  const bySlug = new Map(agents.map((row) => [row.slug, row]));
  if (input.thread !== "team" && !bySlug.has(input.thread)) {
    throw new AppError("not_found", undefined, "That colleague is not on the team.");
  }
  const woke = wakeTargets(input.thread, input.body, agents).filter((slug) => bySlug.has(slug));
  const { data: id, error } = await db.rpc("workforce_post_message", {
    p_thread: input.thread,
    p_body: input.body,
    p_author_id: actor.userId,
    p_author_name: await personName(db, actor),
    p_wake: woke,
    // H101: only a signed-in person's line counts as a person's.
    p_author_kind: actor.kind === "human" ? "human" : "agent",
  });
  if (error !== null) throw fromRpcError(error);
  return { id, woke };
}

export async function hireAgent(
  actor: AdminActor,
  db: Db,
  input: HireInput,
): Promise<{ id: string }> {
  authorize(actor, "workforce.hire");
  const { data: id, error } = await db.rpc("workforce_hire", {
    p_slug: input.slug,
    p_name: input.name,
    p_role: input.role,
    p_instructions: input.instructions,
    p_model: input.model,
    p_wake_on: input.wake_on,
    p_tools: input.tools,
    ...auditContext(actor),
  });
  if (error !== null) throw fromRpcError(error);
  return { id };
}

export async function updateAgent(
  actor: AdminActor,
  db: Db,
  slug: string,
  input: z.infer<typeof agentUpdateSchema>,
): Promise<{ id: string }> {
  authorize(actor, "workforce.update");
  // Only the fields the person changed; an absent field stays as it is.
  const { name, role, instructions, model, wake_on, tools, state } = input;
  const change = {
    ...(name === undefined ? {} : { name }),
    ...(role === undefined ? {} : { role }),
    ...(instructions === undefined ? {} : { instructions }),
    ...(model === undefined ? {} : { model }),
    ...(wake_on === undefined ? {} : { wake_on }),
    ...(tools === undefined ? {} : { tools }),
    ...(state === undefined ? {} : { state }),
  };
  const { data: id, error } = await db.rpc("workforce_update_agent", {
    p_slug: slug,
    p_change: change,
    ...auditContext(actor),
  });
  if (error !== null) throw fromRpcError(error);
  return { id };
}

export async function listApprovals(
  actor: AdminActor,
  db: Db,
): Promise<{ items: AgentApproval[] }> {
  authorize(actor, "workforce.approvals");
  const [{ data, error }, agents] = await Promise.all([
    db
      .from("agent_approvals")
      .select(
        "id, agent_id, action, summary, content, content_hash, state, reason, edited_content, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(50),
    db.from("agents").select("id, slug"),
  ]);
  if (error !== null || agents.error !== null) throw unavailable("The approvals");
  const slugOf = new Map(agents.data.map((row) => [row.id, row.slug]));
  return {
    items: data.map((row) => ({
      id: row.id,
      agent_slug: slugOf.get(row.agent_id) ?? "",
      action: row.action,
      summary: row.summary,
      content: z.record(z.unknown()).safeParse(row.content).data ?? {},
      content_hash: row.content_hash,
      state:
        row.state === "approved" || row.state === "rejected" || row.state === "void"
          ? row.state
          : "pending",
      reason: row.reason,
      edited_content:
        row.edited_content === null
          ? null
          : (z.record(z.unknown()).safeParse(row.edited_content).data ?? null),
      created_at: row.created_at,
    })),
  };
}

/** A person's decision on one proposal. Approval holds only for the exact content the person saw (W1 invariant 3). */
export async function decideApproval(
  actor: AdminActor,
  db: Db,
  id: string,
  input: {
    decision: "approved" | "rejected";
    content_hash: string;
    reason?: string | undefined;
    edited_body?: string | undefined;
  },
): Promise<{ state: string }> {
  authorize(actor, "workforce.decide");
  const { data: state, error } = await db.rpc("workforce_decide", {
    p_id: id,
    p_decision: input.decision,
    p_content_hash: input.content_hash,
    ...(input.reason === undefined ? {} : { p_reason: input.reason }),
    ...(input.edited_body === undefined ? {} : { p_edited_body: input.edited_body }),
    ...auditContext(actor),
  });
  if (error !== null) throw fromRpcError(error);
  return { state };
}
