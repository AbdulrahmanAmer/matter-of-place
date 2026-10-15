import { z } from "zod";

// W9 item 2 (operator, 2026-10-15: "we need to be able to see from the admin dashboard if an email is wrong or
// bounced"): what became of each email we sent, from `email_messages` and the Resend events `email_events` holds, and
// the do-not-send list `email_suppressions`. API JSON is the snake_case row shape.

const uuid = z.string().uuid();
const at = z.string();

/** The states `email_messages.status` takes (migration 20261005013003_email.sql). */
export const emailStates = [
  "queued",
  "sent",
  "delivered",
  "bounced",
  "complained",
  "failed",
  "skipped",
] as const;

/** Why an address is on the do-not-send list (`email_suppressions.reason`). */
const suppressionReasons = ["bounce", "complaint", "manual", "refused"] as const;

export const suppressionSchema = z.object({
  email: z.string(),
  reason: z.enum(suppressionReasons),
  at,
});

export const sentEmailSchema = z.object({
  id: uuid,
  template_key: z.string(),
  to_email: z.string().nullable(),
  status: z.enum(emailStates),
  /** The skip reason or the provider's refusal code, as the send step wrote it. */
  error: z.string().nullable(),
  /** `Permanent` or `Transient` for a bounce, from the bounce event. */
  bounce_type: z.string().nullable(),
  entity: z.string().nullable(),
  entity_id: uuid.nullable(),
  created_at: at,
  sent_at: at.nullable(),
  delivered_at: at.nullable(),
  /** The address is on the do-not-send list. */
  suppressed: z.boolean(),
});

export type SentEmail = z.infer<typeof sentEmailSchema>;

/** `GET /api/admin/submissions/:id/emails`: every email about one request, newest first. */
export const submissionEmailsSchema = z.object({
  address: z.string(),
  suppression: suppressionSchema.nullable(),
  items: z.array(sentEmailSchema),
});

export type SubmissionEmails = z.infer<typeof submissionEmailsSchema>;

/** `POST /api/admin/submissions/:id/resend-email`: the email to send again and the corrected address. */
export const resendEmailInputSchema = z.object({
  id: uuid,
  message_id: uuid,
  email: z.string().trim().toLowerCase().email().max(254),
});

export const resendEmailAnswerSchema = z.object({ job_id: uuid });

/** `GET /api/admin/emails`: the newest emails, filtered by state or address, and the do-not-send list. */
export const emailListInputSchema = z.object({
  status: z.enum(emailStates).optional(),
  search: z.string().trim().max(254).optional(),
});

export const emailListSchema = z.object({
  items: z.array(sentEmailSchema),
  suppressions: z.array(suppressionSchema),
});

/** The states `email_replies.state` takes (migration 20261013180000_email_replies.sql). */
export const replyStates = ["new", "seen", "answered", "ignored"] as const;

/** The states a person may mark a reply with: `seen` when it is opened, `answered` or `ignored` when dealt with. */
export const replyMarks = ["seen", "answered", "ignored"] as const;

/** The email a reply answers, as it was sent (`email_replies.send_id`). */
const repliedToSchema = z.object({
  id: uuid,
  template_key: z.string(),
  to_email: z.string().nullable(),
  created_at: at,
  sent_at: at.nullable(),
});

/** A reply to our email, read from the mailbox. Its words come from outside the company: plain text, never HTML. */
export const replySchema = z.object({
  id: uuid,
  from_email: z.string().nullable(),
  from_name: z.string().nullable(),
  subject: z.string(),
  body: z.string(),
  received_at: at,
  /** The colleague whose thread the reply went to (`agents.slug`); null when no colleague was on. */
  owner_slug: z.string().nullable(),
  state: z.enum(replyStates),
  /** Null when the email it answers was deleted. */
  sent: repliedToSchema.nullable(),
});

export type Reply = z.infer<typeof replySchema>;

/** `GET /api/admin/emails/replies`: the newest replies, optionally one state. */
export const replyListInputSchema = z.object({ state: z.enum(replyStates).optional() });

export const replyListSchema = z.object({ items: z.array(replySchema) });

/** `POST /api/admin/emails/replies/:id`: the mark and the state the reply is in after it. */
export const replyMarkInputSchema = z.object({ id: uuid, state: z.enum(replyMarks) });

export const replyMarkAnswerSchema = z.object({ id: uuid, state: z.enum(replyStates) });

/** The states a person may send again from the request page (`resend_submission_email`). */
export const resendableStates: readonly SentEmail["status"][] = ["bounced", "failed", "skipped"];

// What a person calls each email; a key not named here reads as "The email".
const emailNames: Readonly<Record<string, string>> = {
  received: "The confirmation",
  declined: "The decline letter",
  accepted: "The acceptance",
  awaiting_assets: "The request for material",
  invoice: "The invoice",
  inquiry_ack: "The reply to the inquiry",
  inquiry_forward: "The forwarded inquiry",
  interest_confirm: "The interest confirmation",
  newsletter_confirm: "The Place Notes confirmation",
  subject_ack: "The privacy request receipt",
  repermission: "The permission check",
  market_open: "The market opening",
};

// Why the send step did not send (its skip and refusal reasons), in plain words.
const notSent: Readonly<Record<string, string>> = {
  suppressed: "this address is on the do-not-send list",
  reserved_domain: "the address is a test address",
  not_allow_listed: "this stage only mails the team's own addresses",
  dry_run: "it was a dry run",
  no_submitter: "the request has no address",
};

/** The name of an email as the team reads it. */
export const emailName = (templateKey: string): string => emailNames[templateKey] ?? "The email";

/** One sentence on what became of an email: "The confirmation bounced: this mailbox does not exist." */
export function deliveryLine(email: SentEmail): string {
  const name = emailName(email.template_key);
  switch (email.status) {
    case "bounced":
      if (email.bounce_type === "Permanent") return `${name} bounced: this mailbox does not exist.`;
      if (email.bounce_type === "Transient")
        return `${name} bounced: the mailbox could not take it for now.`;
      return `${name} bounced.`;
    case "complained":
      return `${name} was marked as spam by the person.`;
    case "failed":
      return `${name} could not be sent${email.error === null ? "" : ` (${email.error})`}.`;
    case "skipped":
      return `${name} was not sent: ${notSent[email.error ?? ""] ?? email.error ?? "no reason was given"}.`;
    case "delivered":
      return `${name} was delivered.`;
    case "sent":
      return `${name} was sent; delivery is not confirmed yet.`;
    case "queued":
      return `${name} is waiting to be sent.`;
  }
}
