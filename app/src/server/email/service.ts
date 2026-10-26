import { z } from "zod";
import {
  emailListSchema,
  sentEmailSchema,
  submissionEmailsSchema,
  suppressionSchema,
  type emailListInputSchema,
  type resendEmailInputSchema,
  type SentEmail,
  type SubmissionEmails,
} from "../../domain/admin-emails.ts";
import { fromRpcError } from "../lib/admin-errors.ts";
import type { AdminActor } from "../lib/admin-route.ts";
import { auditContext } from "../lib/audit.ts";
import { authorize } from "../lib/authz.ts";
import type { Db } from "../lib/db.ts";
import { AppError } from "../lib/errors.ts";

// W9 item 2: what became of every email we sent. Reads `email_messages`, the bounce and complaint events Resend sent
// (`email_events`, written by the webhook through `apply_email_event`) and the do-not-send list; the one write is
// `resend_submission_email`.

const MESSAGE_COLUMNS =
  "id, template_key, to_email, status, error, entity, entity_id, created_at, sent_at, delivered_at, resend_id";
/** The do-not-send list shows its newest hundred. */
const SUPPRESSION_LIMIT = 100;
/** A page starts after the row it names: its `created_at` exactly as listed, then its id. */
const CURSOR = /^(\d{4}-\d\d-\d\dT[\d:.]+(?:Z|[+-]\d\d:\d\d))~([0-9a-f-]{36})$/;

const messageRow = sentEmailSchema
  .omit({ bounce_type: true, opened_at: true, suppressed: true })
  .extend({ resend_id: z.string().nullable() });

type MessageRow = z.infer<typeof messageRow>;

const eventRow = z.object({
  resend_email_id: z.string().nullable(),
  type: z.enum(["email.bounced", "email.opened"]),
  at: z.string(),
  data: z.object({ bounce_type: z.string().nullish() }).passthrough(),
});

/** The rows with each one's bounce type, first open and whether its address is on the do-not-send list. */
async function withDelivery(db: Db, rows: readonly MessageRow[]): Promise<SentEmail[]> {
  const resendIds = rows.flatMap((row) => (row.resend_id === null ? [] : [row.resend_id]));
  const addresses = [
    ...new Set(rows.flatMap((row) => (row.to_email === null ? [] : [row.to_email.toLowerCase()]))),
  ];
  // W7 item 1 review: bounces are read on their own and opens oldest first, so a flood of opens (one per pixel load)
  // cut at PostgREST's row cap can never hide a bounce, and the opens kept are the earliest.
  const events = (type: "email.bounced" | "email.opened") =>
    resendIds.length === 0
      ? { data: [], error: null }
      : db
          .from("email_events")
          .select("resend_email_id, type, at, data")
          .eq("type", type)
          .in("resend_email_id", resendIds)
          .order("at");
  const [bounces, opens, suppressed] = await Promise.all([
    events("email.bounced"),
    events("email.opened"),
    addresses.length === 0
      ? { data: [], error: null }
      : db.from("email_suppressions").select("email").in("email", addresses),
  ]);
  if (bounces.error !== null) throw fromRpcError(bounces.error);
  if (opens.error !== null) throw fromRpcError(opens.error);
  if (suppressed.error !== null) throw fromRpcError(suppressed.error);
  const bounceType = new Map<string | null, string | null>();
  const openedAt = new Map<string | null, string>();
  for (const row of z.array(eventRow).parse([...bounces.data, ...opens.data])) {
    if (row.type === "email.bounced")
      bounceType.set(row.resend_email_id, row.data.bounce_type ?? null);
    // The first open is the one that matters; the events come in any order, and ISO times sort as text.
    else if ((openedAt.get(row.resend_email_id) ?? row.at) >= row.at) {
      openedAt.set(row.resend_email_id, row.at);
    }
  }
  const blocked = new Set(suppressed.data.map((row) => row.email));
  return rows.map(({ resend_id, ...row }) => ({
    ...row,
    bounce_type: resend_id === null ? null : (bounceType.get(resend_id) ?? null),
    opened_at: resend_id === null ? null : (openedAt.get(resend_id) ?? null),
    suppressed: row.to_email !== null && blocked.has(row.to_email.toLowerCase()),
  }));
}

/** `GET /api/admin/submissions/:id/emails`: every email about one request, newest first, and its address's state. */
export async function submissionEmails(
  actor: AdminActor,
  db: Db,
  input: { id: string },
): Promise<SubmissionEmails> {
  authorize(actor, "submissions.get");
  const [request, messages] = await Promise.all([
    db.from("submissions").select("submitter_email").eq("id", input.id).maybeSingle(),
    db
      .from("email_messages")
      .select(MESSAGE_COLUMNS)
      .eq("entity", "submission")
      .eq("entity_id", input.id)
      .order("created_at", { ascending: false }),
  ]);
  if (request.error !== null) throw fromRpcError(request.error);
  if (messages.error !== null) throw fromRpcError(messages.error);
  if (request.data === null) {
    throw new AppError("not_found", undefined, "This request could not be found.");
  }
  const address = request.data.submitter_email;
  const suppression = await db
    .from("email_suppressions")
    .select("email, reason, at")
    .eq("email", address.toLowerCase())
    .maybeSingle();
  if (suppression.error !== null) throw fromRpcError(suppression.error);
  return submissionEmailsSchema.parse({
    address,
    suppression: suppression.data,
    items: await withDelivery(db, z.array(messageRow).parse(messages.data)),
  });
}

/** `POST /api/admin/submissions/:id/resend-email`: the email goes again to the corrected address; answers its job. */
export async function resendSubmissionEmail(
  actor: AdminActor,
  db: Db,
  input: z.output<typeof resendEmailInputSchema>,
): Promise<{ job_id: string }> {
  authorize(actor, "submissions.resend_email");
  const { data, error } = await db.rpc("resend_submission_email", {
    p_submission_id: input.id,
    p_message_id: input.message_id,
    p_email: input.email,
    ...auditContext(actor),
  });
  if (error !== null) throw fromRpcError(error);
  return { job_id: z.string().uuid().parse(data) };
}

const messages = (db: Db, input: z.output<typeof emailListInputSchema>) => {
  const query = db.from("email_messages").select(MESSAGE_COLUMNS);
  const withState = input.status === undefined ? query : query.eq("status", input.status);
  return input.search === undefined || input.search === ""
    ? withState
    : withState.eq("to_email", input.search.toLowerCase());
};

type MessageQuery = ReturnType<typeof messages>;

async function newestFirst(query: MessageQuery, take: number) {
  const { data, error } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(take);
  if (error !== null) throw fromRpcError(error);
  return z.array(messageRow).parse(data);
}

/**
 * `GET /api/admin/emails`: one keyset page of emails, newest first (one state, or one address), and the do-not-send
 * list. The cursor `created_at~id` names the last row of the page before.
 */
export async function listEmails(
  actor: AdminActor,
  db: Db,
  input: z.output<typeof emailListInputSchema>,
): Promise<z.infer<typeof emailListSchema>> {
  authorize(actor, "audit.list");
  const take = input.limit + 1;
  let found: MessageRow[];
  if (input.cursor === undefined) found = await newestFirst(messages(db, input), take);
  else {
    const [, at, id] = CURSOR.exec(input.cursor) ?? [];
    if (at === undefined || id === undefined) {
      throw new AppError("validation", undefined, "This page link is no longer valid.");
    }
    const ties = await newestFirst(messages(db, input).eq("created_at", at).lt("id", id), take);
    found =
      ties.length >= take
        ? ties
        : [
            ...ties,
            ...(await newestFirst(messages(db, input).lt("created_at", at), take - ties.length)),
          ];
  }
  const rows = found.slice(0, input.limit);
  const last = found.length > input.limit ? rows.at(-1) : undefined;
  const suppressions = await db
    .from("email_suppressions")
    .select("email, reason, at")
    .order("at", { ascending: false })
    .limit(SUPPRESSION_LIMIT);
  if (suppressions.error !== null) throw fromRpcError(suppressions.error);
  return emailListSchema.parse({
    items: await withDelivery(db, rows),
    next_cursor: last === undefined ? null : `${last.created_at}~${last.id}`,
    suppressions: z.array(suppressionSchema).parse(suppressions.data),
  });
}
