import { z } from "zod";
import { eventTypes } from "./events.ts";

// W1: the AI employees of Matter of Place. Shared by the admin API, the Office screens and the laptop daemon, so it
// imports nothing from the server (G-1200).

/** What an employee may do. Every outward action is a proposal that a person approves (W1 invariant 3). */
export const agentTools = [
  "read_business",
  "chat",
  "hire",
  "draft_reply",
  "draft_post",
  "draft_newsletter",
] as const;
export type AgentTool = (typeof agentTools)[number];

export const agentToolLabels: Record<AgentTool, string> = {
  read_business: "Reads requests, properties and inquiries",
  chat: "Writes in the team chat",
  hire: "Hires colleagues",
  draft_reply: "Drafts replies to inquiries for approval",
  draft_post: "Drafts social posts for approval",
  draft_newsletter: "Drafts Place Notes for approval",
};

/** What wakes an employee, in the words of the office. */
export const wakeLabels: Record<(typeof eventTypes)[number], string> = {
  "submission.received": "A property request arrives",
  "submission.declined": "A request is declined",
  "submission.accepted": "A request is accepted",
  "submission.awaiting_assets": "A request waits for material",
  "invoice.issued": "An invoice is issued",
  "payment.marked": "A payment is marked",
  "submission.activated": "A property is activated",
  "property.published": "A property is published",
  "property.unpublished": "A property is unpublished",
  "asset.approved": "A visual is approved",
  "asset.rejected": "A visual is rejected",
  "digest.due": "Place Notes is due",
  "inquiry.received": "An inquiry arrives",
  "subscriber.created": "Someone signs up",
  "subscriber.confirmed": "A signup is confirmed",
  "invoice.voided": "An invoice is voided",
  "health.failed": "A health check fails",
  "subject_request.received": "A privacy request arrives",
};

const agentModels = ["opus", "sonnet", "haiku"] as const;
const agentStates = ["idle", "working", "paused", "off"] as const;
export type AgentState = (typeof agentStates)[number];

const slug = z
  .string()
  .regex(/^[a-z][a-z0-9-]{1,39}$/, "Use lower-case letters, digits and dashes");

const agentSchema = z.object({
  id: z.string().uuid(),
  slug,
  name: z.string(),
  role: z.string(),
  instructions: z.string(),
  model: z.enum(agentModels),
  wake_on: z.array(z.string()),
  tools: z.array(z.string()),
  state: z.enum(agentStates),
  current_task: z.string().nullable(),
  last_seen_at: z.string().nullable(),
  created_at: z.string(),
  runs_today: z.number().int().nonnegative(),
});
export type Agent = z.infer<typeof agentSchema>;

export const hireInputSchema = z.object({
  slug,
  name: z.string().trim().min(1).max(80),
  role: z.string().trim().min(1).max(120),
  instructions: z.string().trim().max(8000).default(""),
  model: z.enum(agentModels).default("sonnet"),
  wake_on: z.array(z.enum(eventTypes)).default([]),
  tools: z.array(z.enum(agentTools)).default(["read_business", "chat"]),
});
export type HireInput = z.infer<typeof hireInputSchema>;

export const agentUpdateSchema = hireInputSchema
  .omit({ slug: true })
  .partial()
  .extend({ state: z.enum(["idle", "paused", "off"]).optional() });

export const threadSchema = z.union([z.literal("team"), slug]);

export const messageSchema = z.object({
  id: z.string().uuid(),
  thread: z.string(),
  author_kind: z.enum(["human", "agent", "system"]),
  author_id: z.string(),
  author_name: z.string(),
  body: z.string(),
  created_at: z.string(),
});
export type AgentMessage = z.infer<typeof messageSchema>;

export const postMessageSchema = z.object({
  thread: threadSchema,
  body: z.string().trim().min(1).max(4000),
});

const runSchema = z.object({
  id: z.string().uuid(),
  agent_slug: z.string(),
  cause: z.enum(["event", "message", "schedule"]),
  state: z.enum(["queued", "running", "done", "failed"]),
  summary: z.string().nullable(),
  error: z.string().nullable(),
  created_at: z.string(),
  finished_at: z.string().nullable(),
});
export type AgentRun = z.infer<typeof runSchema>;

export const approvalSchema = z.object({
  id: z.string().uuid(),
  agent_slug: z.string(),
  action: z.string(),
  summary: z.string(),
  content: z.record(z.unknown()),
  content_hash: z.string(),
  state: z.enum(["pending", "approved", "rejected", "void"]),
  created_at: z.string(),
});
export type AgentApproval = z.infer<typeof approvalSchema>;

export const officeSchema = z.object({
  agents: z.array(agentSchema),
  runs: z.array(runSchema),
  pending_approvals: z.number().int().nonnegative(),
});
export type Office = z.infer<typeof officeSchema>;

/**
 * Who a person's message wakes: in a direct thread, that colleague; in the team chat, everyone @mentioned, or the chief
 * of staff when nobody is. A colleague who is off is never woken; a paused one is, and waits until resumed.
 */
export function wakeTargets(
  thread: string,
  body: string,
  team: readonly { slug: string; state: string }[],
): string[] {
  const onDuty = (slug: string) =>
    team.some((member) => member.slug === slug && member.state !== "off");
  if (thread !== "team") return onDuty(thread) ? [thread] : [];
  // Mentioning only colleagues who are off still reaches someone: the chief of staff answers instead.
  const mentioned = mentionedSlugs(body).filter(onDuty);
  if (mentioned.length > 0) return mentioned;
  return onDuty("chief") ? ["chief"] : [];
}

/** `@chief` and `@social` in a message wake those employees; `@team` wakes the chief of staff for the whole team. */
export function mentionedSlugs(body: string): string[] {
  return [
    ...new Set(
      [...body.matchAll(/(?:^|[\s(])@([a-z][a-z0-9-]{1,39})\b/g)].map((match) => match[1] ?? ""),
    ),
  ].filter((value) => value !== "");
}
