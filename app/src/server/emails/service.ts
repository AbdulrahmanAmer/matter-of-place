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
} from "../../domain/admin-emails";
import { fromRpcError } from "../lib/admin-errors";
import type { AdminActor } from "../lib/admin-route";
import { auditContext } from "../lib/audit";
import { authorize } from "../lib/authz";
import type { Db } from "../lib/db";
import { AppError } from "../lib/errors";

// W9 item 2: what became of every email we sent. Reads `email_messages`, the bounce and complaint events Resend sent
// (`email_events`, written by the webhook through `apply_email_event`) and the do-not-send list; the one write is
// `resend_submission_email`.

const MESSAGE_COLUMNS =
  "id, template_key, to_email, status, error, entity, entity_id, created_at, sent_at, delivered_at, resend_id";
const LIST_LIMIT = 100;

const messageRow = sentEmailSchema
  .omit({ bounce_type: true, suppressed: true })
  .extend({ resend_id: z.string().nullable() });

type MessageRow = z.infer<typeof messageRow>;

const bounceRow = z.object({
  resend_email_id: z.string().nullable(),
  data: z.object({ bounce_type: z.string().nullish() }).passthrough(),
});

/** The rows with each one's bounce type and whether its address is on the do-not-send list. */
async function withDelivery(db: Db, rows: readonly MessageRow[]): Promise<SentEmail[]> {
  const resendIds = rows.flatMap((row) => (row.resend_id === null ? [] : [row.resend_id]));
  const addresses = [
    ...new Set(rows.flatMap((row) => (row.to_email === null ? [] : [row.to_email.toLowerCase()]))),
  ];
  const [bounces, suppressed] = await Promise.all([
    resendIds.length === 0
      ? { data: [], error: null }
      : db
          .from("email_events")
          .select("resend_email_id, data")
          .eq("type", "email.bounced")
          .in("resend_email_id", resendIds),
    addresses.length === 0
      ? { data: [], error: null }
      : db.from("email_suppressions").select("email").in("email", addresses),
  ]);
  if (bounces.error !== null) throw fromRpcError(bounces.error);
  if (suppressed.error !== null) throw fromRpcError(suppressed.error);
  const bounceType = new Map(
    z
      .array(bounceRow)
      .parse(bounces.data)
      .map((row) => [row.resend_email_id, row.data.bounce_type ?? null]),
  );
  const blocked = new Set(suppressed.data.map((row) => row.email));
  return rows.map(({ resend_id, ...row }) => ({
    ...row,
    bounce_type: resend_id === null ? null : (bounceType.get(resend_id) ?? null),
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

/** `GET /api/admin/emails`: the newest hundred emails (one state, or one address), and the do-not-send list. */
export async function listEmails(
  actor: AdminActor,
  db: Db,
  input: z.output<typeof emailListInputSchema>,
): Promise<z.infer<typeof emailListSchema>> {
  authorize(actor, "audit.list");
  let query = db
    .from("email_messages")
    .select(MESSAGE_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(LIST_LIMIT);
  if (input.status !== undefined) query = query.eq("status", input.status);
  if (input.search !== undefined && input.search !== "")
    query = query.eq("to_email", input.search.toLowerCase());
  const [messages, suppressions] = await Promise.all([
    query,
    db
      .from("email_suppressions")
      .select("email, reason, at")
      .order("at", { ascending: false })
      .limit(LIST_LIMIT),
  ]);
  if (messages.error !== null) throw fromRpcError(messages.error);
  if (suppressions.error !== null) throw fromRpcError(suppressions.error);
  return emailListSchema.parse({
    items: await withDelivery(db, z.array(messageRow).parse(messages.data)),
    suppressions: z.array(suppressionSchema).parse(suppressions.data),
  });
}
