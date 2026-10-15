import { z } from "zod";
import {
  replyListSchema,
  replyMarkAnswerSchema,
  replySchema,
  type replyListInputSchema,
  type replyMarkInputSchema,
} from "../../../domain/admin-emails.ts";
import { fromRpcError } from "../../lib/admin-errors.ts";
import type { AdminActor } from "../../lib/admin-route.ts";
import { auditContext } from "../../lib/audit.ts";
import { authorize } from "../../lib/authz.ts";
import type { Db } from "../../lib/db.ts";
import { AppError } from "../../lib/errors.ts";

// W7 item 2: the replies W4 reads from the mailbox (`email_replies`), each beside the email it answers, and the one
// write, `email_reply_mark`. A reply's words come from outside the company: they go to a person's screen and to
// nothing else, never into a prompt.

const REPLY_COLUMNS =
  "id, from_email, from_name, subject, body, received_at, owner_slug, state, send_id";
const SENT_COLUMNS = "id, template_key, to_email, created_at, sent_at";
/** A page starts after the row it names: its `received_at` exactly as listed, then its id. */
const CURSOR = /^(\d{4}-\d\d-\d\dT[\d:.]+(?:Z|[+-]\d\d:\d\d))~([0-9a-f-]{36})$/;

const replyRow = replySchema.omit({ sent: true }).extend({ send_id: z.string().uuid().nullable() });
const sentRow = z.object({
  id: z.string().uuid(),
  template_key: z.string(),
  to_email: z.string().nullable(),
  created_at: z.string(),
  sent_at: z.string().nullable(),
});

const replies = (db: Db, state: string | undefined) => {
  const query = db.from("email_replies").select(REPLY_COLUMNS);
  return state === undefined ? query : query.eq("state", state);
};

type ReplyQuery = ReturnType<typeof replies>;

async function newestFirst(query: ReplyQuery, take: number) {
  const { data, error } = await query
    .order("received_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(take);
  if (error !== null) throw fromRpcError(error);
  return z.array(replyRow).parse(data);
}

/**
 * `GET /api/admin/emails/replies`: one keyset page of replies, newest first (or one state), each with the email it
 * answers. The cursor `received_at~id` names the last row of the page before.
 */
export async function listReplies(
  actor: AdminActor,
  db: Db,
  input: z.output<typeof replyListInputSchema>,
): Promise<z.infer<typeof replyListSchema>> {
  authorize(actor, "audit.list");
  const take = input.limit + 1;
  let found: Awaited<ReturnType<typeof newestFirst>>;
  if (input.cursor === undefined) found = await newestFirst(replies(db, input.state), take);
  else {
    const [, at, id] = CURSOR.exec(input.cursor) ?? [];
    if (at === undefined || id === undefined) {
      throw new AppError("validation", undefined, "This page link is no longer valid.");
    }
    const ties = await newestFirst(
      replies(db, input.state).eq("received_at", at).lt("id", id),
      take,
    );
    found =
      ties.length >= take
        ? ties
        : [
            ...ties,
            ...(await newestFirst(
              replies(db, input.state).lt("received_at", at),
              take - ties.length,
            )),
          ];
  }
  const rows = found.slice(0, input.limit);
  const last = found.length > input.limit ? rows.at(-1) : undefined;
  const sendIds = [...new Set(rows.flatMap((row) => (row.send_id === null ? [] : [row.send_id])))];
  const sends =
    sendIds.length === 0
      ? { data: [], error: null }
      : await db.from("email_messages").select(SENT_COLUMNS).in("id", sendIds);
  if (sends.error !== null) throw fromRpcError(sends.error);
  const sent = new Map(
    z
      .array(sentRow)
      .parse(sends.data)
      .map((row) => [row.id, row]),
  );
  return replyListSchema.parse({
    items: rows.map(({ send_id, ...row }) => ({
      ...row,
      sent: send_id === null ? null : (sent.get(send_id) ?? null),
    })),
    next_cursor: last === undefined ? null : `${last.received_at}~${last.id}`,
  });
}

/** `POST /api/admin/emails/replies/:id`: `seen`, `answered` or `ignored`; answers the state the reply is in now. */
export async function markReply(
  actor: AdminActor,
  db: Db,
  input: z.output<typeof replyMarkInputSchema>,
): Promise<z.infer<typeof replyMarkAnswerSchema>> {
  authorize(actor, "audit.reply_mark");
  const { data, error } = await db.rpc("email_reply_mark", {
    p_reply_id: input.id,
    p_state: input.state,
    ...auditContext(actor),
  });
  if (error !== null) throw fromRpcError(error);
  return replyMarkAnswerSchema.parse({ id: input.id, state: data });
}
