import { z } from "zod";
import type { StepContext } from "../jobs/types.ts";
import { AppError } from "../lib/errors.ts";
import { call, connect, GraphError, type Session } from "./meta.ts";

// W8 item 4: Instagram comments and messages through the Meta adapter's session (R32): the same Graph version, Page
// token and `appsecret_proof` as posting, every answer parsed before it is read (R33), and a reply written only when
// `liveSideEffects("social")` says so (`call` refuses every POST otherwise, R35). The calls follow the Graph API's
// documented shapes: `GET /{ig-media-id}/comments`, `GET /{ig-comment-id}/replies`,
// `GET /{page-id}/conversations?platform=instagram`, `GET /{conversation-id}/messages`, `POST /{ig-comment-id}/replies`
// and `POST /{page-id}/messages`. Only the handle of a person is kept; a message's recipient is read from its
// conversation when the reply is sent.
// Round 3: Graph documents no order for these lists, so every list is read to its end, a page cut short by the read's
// caps is kept as Graph's `after` cursor (`Pending`, stored with the time cursor) and the next read resumes it first.
// Round 4: one list's error never throws the whole read (`readList`), and a rate limit keeps what was read.

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
  /** Whether the words hold a letter: a row without one (emoji alone) is recorded and wakes no one (round 2). */
  letters: boolean;
};

const idField = z.string().min(1);

/**
 * Round 3: one list a read left part way, keyed by the node whose list it is (a post, a comment, our Page, a
 * conversation): Graph's `after` cursor where it stopped, the time it is read back to and when its read began.
 */
const passSchema = z.object({
  edge: z.enum(["comments", "replies", "conversations", "messages"]),
  /** A comment's media, or a message's conversation, as `InboxItem.thread_graph_id`. */
  thread: idField,
  /** Round 4: none for a list Graph's rate limit stopped before its first page; it is read from there. */
  after: idField.optional(),
  since: z.string().nullable(),
  started: z.string(),
});
export const pendingSchema = z.record(idField, passSchema);
export type Pending = z.infer<typeof pendingSchema>;

/** A list to read this tick: a pending one from its cursor, a fresh one from its first page. */
type Pass = Omit<Pending[string], "after"> & { node: string; after: string | undefined };

/**
 * What one read found: the new items, the next time cursor and the lists it left part way. `truncated` is a read
 * that hit a cap; the next read resumes each pending list, and the time cursor never passes the start of an open one.
 */
export interface InboxRead {
  items: InboxItem[];
  newest: string | null;
  truncated: boolean;
  pending: Pending;
  /** Round 4: Graph's rate limit stopped the read; what it read and the lists left are recorded all the same. */
  limited: boolean;
}

/** A comment page holds at most this many; one read reads at most this many pages of a list, and calls in all. */
const PAGE_LIMIT = "50";
const MAX_PAGES = 4;
const MAX_CALLS = 100;
/** Instagram's own limits: a comment of 2,200 characters, a message of 1,000. */
const REPLY_LIMITS = { comment: 2200, message: 1000 } as const;

const author = z.object({ id: idField, username: z.string().optional() }).passthrough();
// `next` is present only while another page follows.
const pageCursor = z
  .object({
    cursors: z.object({ after: z.string().optional() }).passthrough().optional(),
    next: z.string().optional(),
  })
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
          .object({ data: z.array(commentShape), paging: pageCursor })
          .passthrough()
          .optional(),
      }),
    ),
    paging: pageCursor,
  })
  .passthrough();
const messageShape = z
  .object({
    id: idField,
    message: z.string().default(""),
    created_time: z.string(),
    from: author,
  })
  .passthrough();
const messagePageSchema = z
  .object({ data: z.array(messageShape), paging: pageCursor })
  .passthrough();
const conversationListSchema = z
  .object({
    data: z.array(
      z
        .object({
          id: idField,
          updated_time: z.string(),
          messages: messagePageSchema.optional(),
        })
        .passthrough(),
    ),
    paging: pageCursor,
  })
  .passthrough();
const participantsSchema = z
  .object({ participants: z.object({ data: z.array(author) }).passthrough() })
  .passthrough();
const replySchema = z.object({ id: idField }).passthrough();
const messageSentSchema = z.object({ message_id: idField }).passthrough();

const COMMENT_FIELDS = "id,text,timestamp,username,from,replies{id,text,timestamp,username,from}";
const REPLY_FIELDS = "id,text,timestamp,username,from";
const CONVERSATION_FIELDS = "id,updated_time,messages.limit(20){id,message,created_time,from}";
const MESSAGE_FIELDS = "id,message,created_time,from";

type CommentShape = z.infer<typeof commentShape>;
type MessageShape = z.infer<typeof messageShape>;
type Paging = z.infer<typeof pageCursor>;

const timeOf = (iso: string): number => {
  const time = Date.parse(iso);
  return Number.isNaN(time) ? 0 : time;
};

/** Newer than the cursor (a null cursor reads everything). */
const after = (iso: string, since: Date | null): boolean =>
  since === null || timeOf(iso) > since.getTime();

/** Graph's cursor to the next page, or undefined at a list's end. */
const nextOf = (paging: Paging): string | undefined =>
  paging?.next === undefined ? undefined : paging.cursors?.after;

const hasLetter = (text: string): boolean => /\p{L}/u.test(text);

function newestOf(times: readonly string[], since: Date | null): string | null {
  const newest = times.reduce((best, time) => Math.max(best, timeOf(time)), since?.getTime() ?? 0);
  return newest === 0 ? null : new Date(newest).toISOString();
}

/** Graph's rate limit, every error of class `retry_at` (meta-errors.ts): it ends the read where it is (round 4). */
export function rateLimited(error: unknown): boolean {
  return error instanceof GraphError && error.detail.class === "retry_at";
}

/** Round 4: Graph's answer for a node that no longer exists (a deleted post, comment or conversation). */
const nodeGone = (error: GraphError): boolean =>
  error.detail.code === 100 && error.detail.subcode === 33;

/** One read in progress: what it found, the calls it made and the lists still to read (nested ones join the end). */
interface Reading {
  session: Session;
  items: InboxItem[];
  times: string[];
  calls: number;
  queue: Pass[];
}

/** Reads one page of a list; answers Graph's cursor to the next page, or undefined at the list's end. */
type PageReader = (reading: Reading, pass: Pass) => Promise<string | undefined>;

/** A nested list (a comment's replies, a conversation's messages) left past its first page joins the read once. */
function nested(reading: Reading, parent: Pass, edge: Pass["edge"], node: string, paging: Paging) {
  const cursor = nextOf(paging);
  if (cursor === undefined || reading.queue.some((pass) => pass.node === node)) return;
  reading.queue.push({ ...parent, edge, node, after: cursor });
}

/**
 * How one list's read ended: read to its end, cut by a cap at a cursor (none: not begun), stopped by Graph's rate limit
 * at a cursor (none: before its first page), its node gone, or refused by Graph.
 */
type ListEnd =
  | { end: "done" }
  | { end: "open" | "limited"; after: string | undefined }
  | { end: "gone" }
  | { end: "failed"; code: number | null };

/**
 * Reads one list from its cursor, at most MAX_PAGES pages within MAX_CALLS. Round 4: Graph's paging docs say a stored
 * cursor goes invalid as items are added or deleted, so a page refused at a cursor is read again from the list's first
 * page, once, with the list's own `since` and `started`. A Graph error never throws past the list, except a token Graph
 * no longer takes, which every list would meet.
 */
async function readList(reading: Reading, pass: Pass, readPage: PageReader): Promise<ListEnd> {
  let cursor = pass.after;
  let restarted = false;
  for (let page = 0; page < MAX_PAGES && reading.calls < MAX_CALLS; page += 1) {
    reading.calls += 1;
    try {
      cursor = await readPage(reading, { ...pass, after: cursor });
      if (cursor === undefined) return { end: "done" };
    } catch (error) {
      if (!(error instanceof GraphError) || error.detail.class === "token_dead") throw error;
      if (rateLimited(error)) return { end: "limited", after: cursor };
      if (nodeGone(error)) return { end: "gone" };
      if (cursor === undefined || restarted) return { end: "failed", code: error.detail.code };
      restarted = true;
      cursor = undefined;
    }
  }
  return { end: "open", after: cursor };
}

/**
 * Reads the pending lists first, oldest first, then the fresh ones, each at most MAX_PAGES pages and all within
 * MAX_CALLS. A list cut short is kept with its cursor; a fresh list not begun holds the time cursor where it was. The
 * time cursor never passes the start of a list read this tick or still open, so nothing written meanwhile is skipped.
 * Round 4: a list whose node is gone is dropped; a list Graph refuses holds the time cursor, so the next read finds
 * it again from its parent; Graph's rate limit stops the read, and every list left, begun or not, is kept and read
 * first next tick, before the lists read this tick.
 */
async function readAll(
  session: Session,
  stored: Pending,
  fresh: Pass[],
  since: Date | null,
  readPage: PageReader,
): Promise<InboxRead> {
  const resumed = Object.entries(stored)
    .map(([node, pass]): Pass => ({ ...pass, node, after: pass.after }))
    .sort((a, b) => timeOf(a.started) - timeOf(b.started));
  const reading: Reading = { session, items: [], times: [], calls: 0, queue: [...resumed] };
  for (const pass of fresh) if (!(pass.node in stored)) reading.queue.push(pass);
  const pending: Pending = {};
  let unread = false;
  let limited = false;
  let open = Infinity;
  for (let index = 0; index < reading.queue.length; index += 1) {
    const pass = reading.queue[index];
    if (pass === undefined) break;
    open = Math.min(open, timeOf(pass.started));
    const ended: ListEnd = limited
      ? { end: "limited", after: pass.after }
      : await readList(reading, pass, readPage);
    const { node, ...rest } = pass;
    if (ended.end === "limited") {
      limited = true;
      pending[node] = { ...rest, after: ended.after };
    } else if (ended.end === "open") {
      const cursor = ended.after;
      if (cursor === undefined) unread = true;
      else {
        pending[node] = { ...rest, after: cursor };
      }
    } else if (ended.end === "gone") {
      session.ctx.log("info", "social_inbox_list_gone", { edge: pass.edge });
    } else if (ended.end !== "done") {
      unread = true;
      session.ctx.log("warn", "social_inbox_list_failed", {
        edge: pass.edge,
        code: ended.end === "failed" ? ended.code : null,
      });
    }
  }
  const newest = newestOf(reading.times, since);
  const held = since === null ? null : since.toISOString();
  return {
    items: reading.items,
    newest: unread
      ? held
      : newest !== null && timeOf(newest) > open
        ? new Date(open).toISOString()
        : newest,
    truncated: unread || Object.keys(pending).length > 0,
    pending,
    limited,
  };
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
    letters: hasLetter(comment.text),
  };
}

const sinceOf = (pass: Pass): Date | null => (pass.since === null ? null : new Date(pass.since));

/** One page of a post's comments (each with the replies it carries) or of a comment's replies. */
const commentPage: PageReader = async (reading, pass) => {
  const answer = await call(
    reading.session,
    "GET",
    `${pass.node}/${pass.edge}`,
    {
      fields: pass.edge === "comments" ? COMMENT_FIELDS : REPLY_FIELDS,
      limit: PAGE_LIMIT,
      ...(pass.after === undefined ? {} : { after: pass.after }),
    },
    commentPageSchema,
    pass.edge,
  );
  const since = sinceOf(pass);
  for (const comment of answer.data) {
    const thread = [
      { comment, parent: pass.edge === "replies" ? pass.node : null },
      ...(comment.replies?.data ?? []).map((reply) => ({ comment: reply, parent: comment.id })),
    ];
    for (const entry of thread) {
      reading.times.push(entry.comment.timestamp);
      if (!after(entry.comment.timestamp, since)) continue;
      const item = commentItem(reading.session, pass.thread, entry.comment, entry.parent);
      if (item !== null) reading.items.push(item);
    }
    nested(reading, pass, "replies", comment.id, comment.replies?.paging);
  }
  return nextOf(answer.paging);
};

/** The comments on our Instagram posts newer than `since`, every post read to its end over one read or more. */
export async function readComments(
  ctx: StepContext,
  mediaIds: readonly string[],
  since: Date | null,
  pending: Pending = {},
): Promise<InboxRead> {
  const session = await connect(ctx);
  // A list of a post no longer read (older than the posts read) is dropped.
  const stored = Object.fromEntries(
    Object.entries(pending).filter(([, pass]) => mediaIds.includes(pass.thread)),
  );
  const fresh = mediaIds.map((mediaId): Pass => ({
    edge: "comments",
    node: mediaId,
    thread: mediaId,
    after: undefined,
    since: since === null ? null : since.toISOString(),
    started: ctx.now.toISOString(),
  }));
  return readAll(session, stored, fresh, since, commentPage);
}

function messageItem(
  reading: Reading,
  conversation: string,
  message: MessageShape,
  since: Date | null,
): void {
  reading.times.push(message.created_time);
  if (!after(message.created_time, since) || message.from.id === reading.session.igUserId) return;
  reading.items.push({
    kind: "message",
    graph_id: message.id,
    thread_graph_id: conversation,
    parent_graph_id: null,
    author_handle: (message.from.username ?? "").slice(0, 100),
    body: message.message.slice(0, 4000),
    received_at: message.created_time,
    letters: hasLetter(message.message),
  });
}

/** One page of our conversations (each with its latest messages) or of one conversation's messages. */
const conversationPage: PageReader = async (reading, pass) => {
  const since = sinceOf(pass);
  const cursor = pass.after === undefined ? {} : { after: pass.after };
  if (pass.edge === "messages") {
    const answer = await call(
      reading.session,
      "GET",
      `${pass.node}/messages`,
      { fields: MESSAGE_FIELDS, ...cursor },
      messagePageSchema,
      "messages",
    );
    for (const message of answer.data) messageItem(reading, pass.node, message, since);
    return nextOf(answer.paging);
  }
  const answer = await call(
    reading.session,
    "GET",
    `${pass.node}/conversations`,
    { platform: "instagram", fields: CONVERSATION_FIELDS, ...cursor },
    conversationListSchema,
    "conversations",
  );
  for (const conversation of answer.data) {
    reading.times.push(conversation.updated_time);
    // A conversation not updated since the cursor holds no new message.
    if (!after(conversation.updated_time, since)) continue;
    for (const message of conversation.messages?.data ?? [])
      messageItem(reading, conversation.id, message, since);
    nested(
      reading,
      { ...pass, thread: conversation.id },
      "messages",
      conversation.id,
      conversation.messages?.paging,
    );
  }
  return nextOf(answer.paging);
};

/** The messages of our Instagram conversations newer than `since`; our own messages are never read in. */
export async function readMessages(
  ctx: StepContext,
  since: Date | null,
  pending: Pending = {},
): Promise<InboxRead> {
  const session = await connect(ctx);
  // A list of another Page (its ids changed in Settings) is dropped.
  const stored = Object.fromEntries(
    Object.entries(pending).filter(
      ([node, pass]) => pass.edge === "messages" || node === session.pageId,
    ),
  );
  const fresh: Pass = {
    edge: "conversations",
    node: session.pageId,
    thread: session.pageId,
    after: undefined,
    since: since === null ? null : since.toISOString(),
    started: ctx.now.toISOString(),
  };
  return readAll(session, stored, [fresh], since, conversationPage);
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
