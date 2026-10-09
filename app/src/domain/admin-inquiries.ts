import { z } from "zod";
import { adminPageAnswer, adminPageSchema } from "./admin-page.ts";
import { inquiryIntents, type InquiryIntent } from "./contracts.ts";

// Screen 11 (B7 step 11): the inquiries the public forms sent, and what an editor does with them. API JSON is the
// snake_case row shape of the generated types.

export const inquiryStates = ["new", "in_progress", "forwarded", "closed"] as const;

export type InquiryState = (typeof inquiryStates)[number];

/** The states assign, forward and close start from; their SQL functions raise `wrong_state` on any other (R22). */
export const openInquiryStates = [
  "new",
  "in_progress",
  "forwarded",
] as const satisfies readonly InquiryState[];

export const inquiryStateLabels: Record<InquiryState, string> = {
  new: "New",
  in_progress: "In progress",
  forwarded: "Forwarded",
  closed: "Closed",
};

export const inquiryIntentLabels: Record<InquiryIntent, string> = {
  showing: "Showing",
  ask: "Question",
  similar: "Similar homes",
  sell: "Selling",
  invest: "Investing",
  agent: "Agent",
  general: "General",
};

const uuid = z.string().uuid();

/** `GET /api/admin/inquiries`. */
export const inquiryListInputSchema = adminPageSchema.extend({
  state: z.enum(inquiryStates).optional(),
});

export type InquiryListInput = z.infer<typeof inquiryListInputSchema>;

/** One inquiry as screen 11 shows it; the IP hash, the Turnstile flag and the attribution stay on the server. */
export const inquiryRowSchema = z.object({
  id: uuid,
  intent: z.enum(inquiryIntents),
  topic: z.string().nullable(),
  subject_kind: z.string().nullable(),
  subject_slug: z.string().nullable(),
  subject_title: z.string().nullable(),
  name: z.string(),
  email: z.string(),
  phone: z.string().nullable(),
  location: z.string().nullable(),
  message: z.string(),
  details: z.record(z.unknown()),
  source_path: z.string(),
  state: z.enum(inquiryStates),
  received_at: z.string(),
  forwarded_at: z.string().nullable(),
  assigned_to: uuid.nullable(),
  /** Set by B8's retention or `delete_subject`: the contact fields hold nothing personal any more. */
  anonymised_at: z.string().nullable(),
});

export type InquiryRow = z.infer<typeof inquiryRowSchema>;

/** `forward_available` is false until the `webhook_omnikom` step is registered (B15), and the drawer disables Forward. */
export const inquiryListSchema = adminPageAnswer(inquiryRowSchema).extend({
  forward_available: z.boolean(),
});

export const inquiryDetailSchema = inquiryRowSchema.extend({ forward_available: z.boolean() });

export type InquiryDetail = z.infer<typeof inquiryDetailSchema>;

/** The path parameter of `GET /api/admin/inquiries/:id`, and the body of forward and close. */
export const inquiryIdInputSchema = z.object({ id: uuid });

/** `POST /api/admin/inquiries/:id/assign`. */
export const assignInquiryInputSchema = inquiryIdInputSchema.extend({ assignee: uuid });

export const inquiryStateAnswerSchema = z.object({ state: z.enum(inquiryStates) });

export const forwardAnswerSchema = z.object({ job_id: uuid });

/** `GET /api/admin/inquiries/assignees`: the people who may act on inquiries, by name. */
export const assigneesSchema = z.object({
  items: z.array(z.object({ id: uuid, name: z.string() })),
});

export type Assignee = z.infer<typeof assigneesSchema>["items"][number];
