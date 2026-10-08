import { z } from "zod";
import { issueStatuses, newsletterBlocksSchema } from "./newsletter.ts";

// Screen 13 (B11 step 7): the shapes of `/api/admin/newsletter/*`, shared by the route files and the browser. API JSON
// is the snake_case row shape of the generated types.

const uuid = z.string().uuid();

/** The path parameter of every `/api/admin/newsletter/issues/:id` route. */
export const issueIdInputSchema = z.object({ id: uuid });

/** The counts `newsletter_set_metrics` writes once an issue has gone out; an issue not sent yet has none. */
const issueMetricsSchema = z.object({
  delivered: z.number().int().optional(),
  opened: z.number().int().optional(),
  clicked: z.number().int().optional(),
  unsubscribed: z.number().int().optional(),
});

/** One issue as screen 13 shows it. `approve`, `unapprove` and `update` answer with the same row. */
export const issueSchema = z.object({
  id: uuid,
  number: z.number().int(),
  status: z.enum(issueStatuses),
  blocks: newsletterBlocksSchema,
  subject: z.string().nullable(),
  preheader: z.string().nullable(),
  scheduled_for: z.string().nullable(),
  sent_at: z.string().nullable(),
  send_error: z.string().nullable(),
  approval_count: z.number().int(),
  metrics: issueMetricsSchema,
});

export type Issue = z.infer<typeof issueSchema>;

/** `GET /api/admin/newsletter/issues`: every issue, newest first. */
export const issueListSchema = z.array(issueSchema);

export const SUBJECT_MAX = 150;
export const PREHEADER_MAX = 200;

/** `PUT /api/admin/newsletter/issues/:id`: the whole draft, blocks in reading order. */
export const issueUpdateInputSchema = issueIdInputSchema.extend({
  blocks: newsletterBlocksSchema,
  subject: z.string().trim().min(1).max(SUBJECT_MAX),
  preheader: z.string().trim().max(PREHEADER_MAX),
});

export type IssueUpdateInput = z.infer<typeof issueUpdateInputSchema>;

export const viewports = ["desktop", "phone"] as const;

/** `GET /api/admin/newsletter/issues/:id/preview`. */
export const previewInputSchema = issueIdInputSchema.extend({
  viewport: z.enum(viewports).default("desktop"),
});

/** The issue as HTML for an iframe, and the width of that frame in pixels. */
export const previewSchema = z.object({ html: z.string(), width: z.number().int() });

/** `POST /api/admin/newsletter/issues/:id/approve`; no `send_at` means now. */
export const approveInputSchema = issueIdInputSchema.extend({
  send_at: z.string().datetime().optional(),
});

/** `POST /api/admin/newsletter/issues/:id/send-test`: the job id, or null when the same minute already queued one. */
export const sendTestSchema = z.object({ job_id: z.string().nullable() });

/** `POST /api/admin/newsletter/issues/build`. */
export const builtIssueSchema = z.object({ id: uuid, number: z.number().int() });

/** `GET /api/admin/newsletter/subscribers`: how many subscribers are in each state and audience, never an address. */
export const subscriberCountsSchema = z.object({
  total: z.number().int(),
  confirmed: z.number().int(),
  pending: z.number().int(),
  unsubscribed: z.number().int(),
  interest_only: z.number().int(),
  audiences: z.object({
    "place-notes": z.number().int(),
    "market-ca": z.number().int(),
    "market-ny": z.number().int(),
    "market-fl": z.number().int(),
  }),
});

export type SubscriberCountsView = z.infer<typeof subscriberCountsSchema>;
