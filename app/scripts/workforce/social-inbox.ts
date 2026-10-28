// W8 item 4: the Social colleague's reply to an Instagram comment or message, filed by the runner. The proposal goes to
// Approvals (a person approves it; Matter may decline or pass) through `social_inbox_propose`, which marks the comment
// `proposed` in the same transaction; an approved one is sent by the `send_social_reply` job. Which comment it answers
// is the runner's triage record (the row the event named), never anything the colleague wrote, so a reply can only
// ever answer the message it was woken for. CRITICAL (outside text).
import { createHash } from "node:crypto";
import type { Db } from "../../src/server/lib/db.ts";
import type { Triage } from "./triage.ts";

/** The proposal a colleague makes to answer a comment or message (criteria.ts, `social_comment`). */
export const REPLY_SOCIAL = "reply_social";

/** Instagram's own limits, as `social_inbox_propose` checks them: a comment of 2,200 characters, a message of 1,000. */
const REPLY_LIMITS = { comment: 2200, message: 1000 } as const;
/** Instagram takes a reply to a message only within 24 hours of the person's latest message in the conversation. */
const WINDOW_MS = 24 * 60 * 60 * 1000;

const RECORD = /^social_comment ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

/** The comment or message a triaged run is about: its `social_inbox` id from the runner's record, or null. */
export function inboxOf(triage: Triage | null): string | null {
  if (triage?.source !== "social_comment") return null;
  return RECORD.exec(triage.about)?.[1] ?? null;
}

/** The reply's words from the proposal's content (`body`, or `text`), trimmed; empty when there are none. */
export function replyBody(content: unknown): string {
  if (typeof content !== "object" || content === null) return "";
  const body: unknown = "body" in content ? content.body : "text" in content ? content.text : "";
  return typeof body === "string" ? body.trim() : "";
}

/**
 * The row's kind and, for a message, the end of its 24-hour reply window (the person's latest message in the
 * conversation plus 24 hours), shown in Approvals; `social_inbox_reply_begin` checks the window again at the send.
 */
async function targetOf(
  client: Db,
  inbox: string,
): Promise<{ kind: "comment" | "message"; replyBy: string | null } | null> {
  const { data } = await client
    .from("social_inbox")
    .select("kind, thread_graph_id")
    .eq("id", inbox)
    .limit(1);
  const row = data?.[0];
  if (row === undefined) return null;
  if (row.kind !== "message") return { kind: "comment", replyBy: null };
  const { data: latest } = await client
    .from("social_inbox")
    .select("received_at")
    .eq("kind", "message")
    .eq("thread_graph_id", row.thread_graph_id)
    .order("received_at", { ascending: false })
    .limit(1);
  const last = Date.parse(latest?.[0]?.received_at ?? "");
  return {
    kind: "message",
    replyBy: Number.isNaN(last) ? null : new Date(last + WINDOW_MS).toISOString(),
  };
}

/**
 * Files one `reply_social` proposal: the content is the reply's words, the runner's record of the comment and, for a
 * message, its reply window, hashed as Approvals checks it. Returns the line the runner says in the colleague's thread.
 */
export async function fileSocialReply(
  client: Db,
  input: {
    agentId: string;
    runId: string;
    triage: Triage | null;
    summary: string;
    content: unknown;
  },
): Promise<string> {
  const inbox = inboxOf(input.triage);
  if (inbox === null)
    return "The reply was not proposed: this run was not woken by an Instagram comment.";
  const body = replyBody(input.content);
  if (body === "") return "The reply was not proposed: it has no words.";
  const target = await targetOf(client, inbox);
  if (target === null) return "The reply was not proposed: the comment is no longer held.";
  const limit = REPLY_LIMITS[target.kind];
  if (Array.from(body).length > limit) {
    return `The reply was not proposed: Instagram takes ${limit.toLocaleString("en-US")} characters for a ${target.kind}. Write it shorter.`;
  }
  const content = {
    inbox_id: inbox,
    body,
    ...(target.replyBy === null ? {} : { reply_by: target.replyBy }),
  };
  const { error } = await client.rpc("social_inbox_propose", {
    p_inbox_id: inbox,
    p_agent_id: input.agentId,
    p_run_id: input.runId,
    p_summary: input.summary,
    p_content: content,
    p_content_hash: createHash("sha256").update(JSON.stringify(content)).digest("hex"),
  });
  if (error !== null) return `The reply was not proposed: ${error.message}.`;
  return "The reply waits in Approvals for a person's decision.";
}
