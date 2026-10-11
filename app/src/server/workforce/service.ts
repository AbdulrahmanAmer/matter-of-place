import {
  wakeTargets,
  type Agent,
  type AgentApproval,
  type AgentMessage,
  type HireInput,
  type Office,
} from "../../domain/workforce.ts";
import { z } from "zod";
import type { agentUpdateSchema } from "../../domain/workforce.ts";
import type { AdminActor } from "../lib/admin-route.ts";
import { authorize } from "../lib/authz.ts";
import type { Db } from "../lib/db.ts";
import { AppError } from "../lib/errors.ts";

// W1: the admin side of the AI employees. The laptop daemon (scripts/workforce/daemon.ts) does the work; this file
// lists, hires, changes and talks to them, and records the decisions of people on their proposals.

const unavailable = (what: string) =>
  new AppError("unavailable", undefined, `${what} could not be read.`);

async function audit(
  db: Db,
  actor: AdminActor,
  action: string,
  entityId: string,
  after: Record<string, string | string[]>,
): Promise<void> {
  await db.rpc("write_audit", {
    p_actor: actor.userId,
    p_actor_kind: actor.kind,
    p_action: action,
    p_entity: "agents",
    p_entity_id: entityId,
    p_before: null,
    p_after: after,
    p_request_id: actor.requestId,
  });
}

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
  const [agents, runs, today, approvals] = await Promise.all([
    db.from("agents").select("*").order("created_at"),
    db
      .from("agent_runs")
      .select("id, agent_id, cause, state, summary, error, created_at, finished_at")
      .order("created_at", { ascending: false })
      .limit(30),
    db.from("agent_runs").select("agent_id").gte("created_at", since),
    db.from("agent_approvals").select("id", { count: "exact", head: true }).eq("state", "pending"),
  ]);
  if (
    agents.error !== null ||
    runs.error !== null ||
    today.error !== null ||
    approvals.error !== null
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
  const { data: message, error } = await db
    .from("agent_messages")
    .insert({
      thread: input.thread,
      author_kind: "human",
      author_id: actor.userId,
      author_name: await personName(db, actor),
      body: input.body,
    })
    .select("id")
    .single();
  if (error !== null) throw unavailable("The message");

  const awake = wakeTargets(input.thread, input.body, agents)
    .map((slug) => bySlug.get(slug))
    .filter((row): row is NonNullable<typeof row> => row !== undefined);
  if (awake.length > 0) {
    const { error: wakeError } = await db
      .from("agent_runs")
      .insert(awake.map((row) => ({ agent_id: row.id, cause: "message", message_id: message.id })));
    if (wakeError !== null) throw unavailable("The wake-up");
  }
  return { id: message.id, woke: awake.map((row) => row.slug) };
}

export async function hireAgent(
  actor: AdminActor,
  db: Db,
  input: HireInput,
): Promise<{ id: string }> {
  authorize(actor, "workforce.hire");
  const { data, error } = await db
    .from("agents")
    .insert({ ...input, created_by: actor.kind === "human" ? actor.userId : null })
    .select("id")
    .single();
  if (error !== null) {
    if (error.code === "23505")
      throw new AppError("already_exists", undefined, "A colleague already has that name.");
    throw unavailable("The new colleague");
  }
  await db.from("agent_messages").insert({
    thread: "team",
    author_kind: "system",
    author_id: "system",
    author_name: "Matter of Place",
    body: `${input.name} joined the team as ${input.role}.`,
  });
  await audit(db, actor, "workforce.hire", data.id, { slug: input.slug, role: input.role });
  return { id: data.id };
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
  const { data, error } = await db
    .from("agents")
    .update(change)
    .eq("slug", slug)
    .select("id")
    .single();
  if (error !== null)
    throw new AppError("not_found", undefined, "That colleague is not on the team.");
  await audit(db, actor, "workforce.update", data.id, { fields: Object.keys(change) });
  return { id: data.id };
}

export async function listApprovals(
  actor: AdminActor,
  db: Db,
): Promise<{ items: AgentApproval[] }> {
  authorize(actor, "workforce.approvals");
  const [{ data, error }, agents] = await Promise.all([
    db
      .from("agent_approvals")
      .select("id, agent_id, action, summary, content, content_hash, state, created_at")
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
      created_at: row.created_at,
    })),
  };
}

/** A person's decision on one proposal. Approval holds only for the exact content the person saw (W1 invariant 3). */
export async function decideApproval(
  actor: AdminActor,
  db: Db,
  id: string,
  input: { decision: "approved" | "rejected"; content_hash: string },
): Promise<{ state: string }> {
  authorize(actor, "workforce.decide");
  const { data: row, error } = await db
    .from("agent_approvals")
    .select("id, agent_id, content, content_hash, state, summary")
    .eq("id", id)
    .single();
  if (error !== null) throw new AppError("not_found", undefined, "That proposal does not exist.");
  if (row.state !== "pending")
    throw new AppError("wrong_state", undefined, "That proposal was already decided.");
  if (input.decision === "approved" && input.content_hash !== row.content_hash) {
    throw new AppError(
      "version_conflict",
      undefined,
      "The proposal changed after you opened it. Read it again.",
    );
  }
  const { error: updateError } = await db
    .from("agent_approvals")
    .update({
      state: input.decision,
      decided_by: actor.kind === "human" ? actor.userId : null,
      decided_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("state", "pending");
  if (updateError !== null) throw unavailable("The decision");
  await db.from("agent_messages").insert({
    thread: "team",
    author_kind: "system",
    author_id: "system",
    author_name: "Matter of Place",
    body: `${input.decision === "approved" ? "Approved" : "Declined"}: ${row.summary}`,
  });
  await audit(db, actor, "workforce.decide", row.agent_id, {
    approval: id,
    decision: input.decision,
  });
  return { state: input.decision };
}
