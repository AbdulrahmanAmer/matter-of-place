import { z } from "zod";
import type { StepContext } from "../jobs/types.ts";
import { AppError } from "../lib/errors.ts";
import { call, connect, type Session } from "./meta.ts";

// W8 item 4: Instagram comments and messages through the Meta adapter's session (R32): the same Graph version, Page
// token and `appsecret_proof` as posting, every answer parsed before it is read (R33), and a reply written only when
// `liveSideEffects("social")` says so (`call` refuses every POST otherwise, R35). The calls follow the Graph API's
// documented shapes: `GET /{ig-media-id}/comments`, `GET /{page-id}/conversations?platform=instagram`,
// `POST /{ig-comment-id}/replies` and `POST /{page-id}/messages`. Only the handle of a person is kept; a message's
// recipient is read from its conversation when the reply is sent.

/** One comment or message as `social_inbox_record` takes it (a type, so it is `Json` as it stands). */
type InboxItem = {
  kind: "comment" | "message";
  graph_id: string;
  /** A comment: the media it is on; a message: its conversation. */
  thread_graph_id: string;
  /** A reply under a comment: the comment it answers. */
  parent_graph_id: string | null;
  author_handle: string;
  body: string;
  received_at: string;
};

/** What one read found: the new items, and the newest time among everything read (the next cursor). */
export interface InboxRead {
  items: InboxItem[];
  newest: string | null;
}

/** A comment page holds at most this many, and at most this many pages are read for one post. */
const PAGE_LIMIT = "50";
const MAX_PAGES = 4;
/** Instagram's own limits: a comment of 2,200 characters, a message of 1,000. */
const REPLY_LIMITS = { comment: 2200, message: 1000 } as const;

const idField = z.string().min(1);
const author = z.object({ id: idField, username: z.string().optional() }).passthrough();
const pageCursor = z
  .object({ cursors: z.object({ after: z.string().optional() }).passthrough().optional() })
  .passthrough()
  .optional();
const commentShape = z
  .object({
    id: idField,
    text: z.string().default(""),
    timestamp: z.string(),
    username: z.string().optional(),
    from: author.optional(),
  })
  .passthrough();
const commentPageSchema = z
  .object({
    data: z.array(
      commentShape.extend({
        replies: z
          .object({ data: z.array(commentShape) })
          .passthrough()
          .optional(),
      }),
    ),
    paging: pageCursor,
  })
  .passthrough();
const conversationListSchema = z
  .object({
    data: z.array(
      z
        .object({
          id: idField,
          updated_time: z.string(),
          messages: z
            .object({
              data: z.array(
                z
                  .object({
                    id: idField,
                    message: z.string().default(""),
                    created_time: z.string(),
                    from: author,
                  })
                  .passthrough(),
              ),
            })
            .passthrough()
            .optional(),
        })
        .passthrough(),
    ),
  })
  .passthrough();
const participantsSchema = z
  .object({ participants: z.object({ data: z.array(author) }).passthrough() })
  .passthrough();
const replySchema = z.object({ id: idField }).passthrough();
const messageSentSchema = z.object({ message_id: idField }).passthrough();

const COMMENT_FIELDS = "id,text,timestamp,username,from,replies{id,text,timestamp,username,from}";
const CONVERSATION_FIELDS = "id,updated_time,messages.limit(20){id,message,created_time,from}";

type CommentShape = z.infer<typeof commentShape>;

const timeOf = (iso: string): number => {
  const time = Date.parse(iso);
  return Number.isNaN(time) ? 0 : time;
};

/** Newer than the cursor (a null cursor reads everything a page holds). */
const after = (iso: string, since: Date | null): boolean =>
  since === null || timeOf(iso) > since.getTime();

function newestOf(times: readonly string[], since: Date | null): string | null {
  const newest = times.reduce((best, time) => Math.max(best, timeOf(time)), since?.getTime() ?? 0);
  return newest === 0 ? null : new Date(newest).toISOString();
}

/** A comment someone else wrote, as a row; our own account's comments and replies are never read in. */
function commentItem(
  session: Session,
  mediaId: string,
  comment: CommentShape,
  parent: string | null,
): InboxItem | null {
  if (comment.from?.id === session.igUserId) return null;
  return {
    kind: "comment",
    graph_id: comment.id,
    thread_graph_id: mediaId,
    parent_graph_id: parent,
    author_handle: (comment.username ?? comment.from?.username ?? "").slice(0, 100),
    body: comment.text.slice(0, 4000),
    received_at: comment.timestamp,
  };
}

async function commentsOf(
  session: Session,
  mediaId: string,
  since: Date | null,
): Promise<{ items: InboxItem[]; times: string[] }> {
  const items: InboxItem[] = [];
  const times: string[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const answer = await call(
      session,
      "GET",
      `${mediaId}/comments`,
      {
        fields: COMMENT_FIELDS,
        limit: PAGE_LIMIT,
        ...(cursor === undefined ? {} : { after: cursor }),
      },
      commentPageSchema,
      "comments",
    );
    for (const comment of answer.data) {
      const thread = [
        { comment, parent: null },
        ...(comment.replies?.data ?? []).map((reply) => ({ comment: reply, parent: comment.id })),
      ];
      for (const entry of thread) {
        times.push(entry.comment.timestamp);
        if (!after(entry.comment.timestamp, since)) continue;
        const item = commentItem(session, mediaId, entry.comment, entry.parent);
        if (item !== null) items.push(item);
      }
    }
    cursor = answer.paging?.cursors?.after;
    if (cursor === undefined || answer.data.length === 0) break;
  }
  return { items, times };
}

/** The comments on our Instagram posts newer than `since`, each post's pages in turn. */
export async function readComments(
  ctx: StepContext,
  mediaIds: readonly string[],
  since: Date | null,
): Promise<InboxRead> {
  const session = await connect(ctx);
  const items: InboxItem[] = [];
  const times: string[] = [];
  for (const mediaId of mediaIds) {
    const read = await commentsOf(session, mediaId, since);
    items.push(...read.items);
    times.push(...read.times);
  }
  return { items, newest: newestOf(times, since) };
}

/** The messages of our Instagram conversations newer than `since`; our own messages are never read in. */
export async function readMessages(ctx: StepContext, since: Date | null): Promise<InboxRead> {
  const session = await connect(ctx);
  const answer = await call(
    session,
    "GET",
    `${session.pageId}/conversations`,
    { platform: "instagram", fields: CONVERSATION_FIELDS },
    conversationListSchema,
    "conversations",
  );
  const items: InboxItem[] = [];
  const times: string[] = [];
  for (const conversation of answer.data) {
    times.push(conversation.updated_time);
    if (!after(conversation.updated_time, since)) continue;
    for (const message of conversation.messages?.data ?? []) {
      times.push(message.created_time);
      if (!after(message.created_time, since) || message.from.id === session.igUserId) continue;
      items.push({
        kind: "message",
        graph_id: message.id,
        thread_graph_id: conversation.id,
        parent_graph_id: null,
        author_handle: (message.from.username ?? "").slice(0, 100),
        body: message.message.slice(0, 4000),
        received_at: message.created_time,
      });
    }
  }
  return { items, newest: newestOf(times, since) };
}

/** Sends an approved reply: under the comment, or into the conversation to the person in it. Returns its Graph id. */
export async function sendReply(
  ctx: StepContext,
  target: { kind: "comment" | "message"; graph_id: string; thread_graph_id: string },
  text: string,
): Promise<string> {
  if (text.trim() === "" || [...text].length > REPLY_LIMITS[target.kind]) {
    throw new AppError(
      "validation",
      undefined,
      `The reply is empty or longer than Instagram takes (${String(REPLY_LIMITS[target.kind])} characters).`,
    );
  }
  const session = await connect(ctx);
  if (target.kind === "comment") {
    const reply = await call(
      session,
      "POST",
      `${target.graph_id}/replies`,
      { message: text },
      replySchema,
      "comment reply",
    );
    return reply.id;
  }
  const { participants } = await call(
    session,
    "GET",
    target.thread_graph_id,
    { fields: "participants" },
    participantsSchema,
    "participants",
  );
  const person = participants.data.find((participant) => participant.id !== session.igUserId);
  if (person === undefined) {
    throw new AppError("not_found", undefined, "The conversation has no one to reply to.");
  }
  const sent = await call(
    session,
    "POST",
    `${session.pageId}/messages`,
    {
      recipient: JSON.stringify({ id: person.id }),
      message: JSON.stringify({ text }),
      messaging_type: "RESPONSE",
    },
    messageSentSchema,
    "message",
  );
  return sent.message_id;
}
