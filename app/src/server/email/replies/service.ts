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

// W7 item 2: the replies W4 reads from the mailbox (`email_replies`), each beside the email it answers, and the one
// write, `email_reply_mark`. A reply's words come from outside the company: they go to a person's screen and to
// nothing else, never into a prompt.

const REPLY_COLUMNS =
  "id, from_email, from_name, subject, body, received_at, owner_slug, state, send_id";
const SENT_COLUMNS = "id, template_key, to_email, created_at, sent_at";
const LIST_LIMIT = 100;

const replyRow = replySchema.omit({ sent: true }).extend({ send_id: z.string().uuid().nullable() });
const sentRow = z.object({
  id: z.string().uuid(),
  template_key: z.string(),
  to_email: z.string().nullable(),
  created_at: z.string(),
  sent_at: z.string().nullable(),
});

/** `GET /api/admin/emails/replies`: the newest hundred replies (or one state), each with the email it answers. */
export async function listReplies(
  actor: AdminActor,
  db: Db,
  input: z.output<typeof replyListInputSchema>,
): Promise<z.infer<typeof replyListSchema>> {
  authorize(actor, "audit.list");
  let query = db
    .from("email_replies")
    .select(REPLY_COLUMNS)
    .order("received_at", { ascending: false })
    .limit(LIST_LIMIT);
  if (input.state !== undefined) query = query.eq("state", input.state);
  const replies = await query;
  if (replies.error !== null) throw fromRpcError(replies.error);
  const rows = z.array(replyRow).parse(replies.data);
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
