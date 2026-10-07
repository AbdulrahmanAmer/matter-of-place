import { z } from "zod";
import { ADMIN_PAGE_MAX, adminPageAnswer, adminPageSchema } from "./admin-page.ts";
import {
  acceptedStates,
  exposurePackages,
  propertyTypes,
  submissionStates,
  submitterKinds,
} from "./contracts.ts";
import { canTransition, type TransitionContext, type WorkflowState } from "./workflow.ts";

// The admin side of a request (B7 invariant 5, screen 3). API JSON is the snake_case row shape of the generated types.

/** The saved views of screen 3, each a fixed set of states. */
export const savedViews = {
  needs_decision: { label: "Needs decision", states: ["Submitted", "Under Review"] },
  awaiting_assets: { label: "Awaiting assets", states: ["Awaiting Assets"] },
} as const satisfies Record<string, { label: string; states: readonly WorkflowState[] }>;

const savedViewIds = [
  "needs_decision",
  "awaiting_assets",
] as const satisfies readonly (keyof typeof savedViews)[];

/** `GET /api/admin/submissions`. Query values arrive as text. */
export const listSubmissionsInputSchema = adminPageSchema.extend({
  workflow_state: z.enum(submissionStates).optional(),
  view: z.enum(savedViewIds).optional(),
  market: z.enum(acceptedStates).optional(),
  package: z.enum(exposurePackages).optional(),
  /** Address, submitter name or brokerage; `list_submissions` matches it as plain text. */
  search: z
    .string()
    .max(200)
    .transform((text) => text.trim())
    .optional(),
  /** Only the accepted requests still without their property (screen 7, "New from request"). */
  without_property: z
    .enum(["true", "false"])
    .transform((flag) => flag === "true")
    .optional(),
});

export type ListSubmissionsInput = z.infer<typeof listSubmissionsInputSchema>;

/** One row of the view `submission_list`. */
export const submissionListRowSchema = z.object({
  id: z.string().uuid(),
  received_at: z.string(),
  address: z.string(),
  city: z.string(),
  state: z.enum(acceptedStates),
  submitter_kind: z.enum(submitterKinds),
  submitter_name: z.string(),
  brokerage: z.string().nullable(),
  package: z.enum(exposurePackages),
  workflow_state: z.enum(submissionStates),
  accepted_at: z.string().nullable(),
  duplicate_of: z.string().uuid().nullable(),
  turnstile_ok: z.boolean(),
  property_id: z.string().uuid().nullable(),
});

export type SubmissionListRow = z.infer<typeof submissionListRowSchema>;

export const submissionListSchema = adminPageAnswer(submissionListRowSchema);

/** `POST /api/admin/submissions/start-review`: one request from its page, or the selection of screen 3. */
export const startReviewInputSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(ADMIN_PAGE_MAX),
});

export const startReviewAnswerSchema = z.object({ started: z.number().int() });

/** The buttons of a request: B7's moves of the request graph (invariant 5). */
const submissionActions = [
  "start_review",
  "decline",
  "accept",
  "request_assets",
  "assets_received",
  "withdraw",
] as const;

export type SubmissionAction = (typeof submissionActions)[number];

/** Where `action` takes a request in `from`, or null when the action does not start there. */
export function actionTarget(
  action: SubmissionAction,
  from: WorkflowState,
  ctx: TransitionContext,
): WorkflowState | null {
  switch (action) {
    case "start_review":
      return from === "Submitted" ? "Under Review" : null;
    case "decline":
      return from === "Under Review" ? "Declined" : null;
    case "accept":
      return from === "Under Review" ? "Accepted" : null;
    case "request_assets":
      return from === "Under Review" || from === "Accepted" ? "Awaiting Assets" : null;
    case "assets_received":
      if (from !== "Awaiting Assets") return null;
      return ctx.acceptedAt === null ? "Under Review" : "Accepted";
    case "withdraw":
      return "Withdrawn";
  }
}

/** The actions a request in `state` offers: those whose move B2's `canTransition` lets through. */
export function allowedActions(state: WorkflowState, ctx: TransitionContext): SubmissionAction[] {
  return submissionActions.filter((action) => {
    const to = actionTarget(action, state, ctx);
    return to !== null && canTransition(state, to, ctx);
  });
}

const uuid = z.string().uuid();

/** The path parameter of every read and write on one request. */
export const submissionIdInputSchema = z.object({ id: uuid });

/** `GET /api/admin/submissions/:id/media/:mediaId/original`. */
export const originalInputSchema = submissionIdInputSchema.extend({ mediaId: uuid });

export const originalAnswerSchema = z.object({ url: z.string().url() });

/** `POST /api/admin/submissions/:id/note`: the words of an internal note, 1 to 2,000 characters. */
export const noteInputSchema = submissionIdInputSchema.extend({
  text: z
    .string()
    .transform((text) => text.trim())
    .pipe(z.string().min(1).max(2000)),
});

/** One internal note, as `add_submission_note` stores it in `submissions.notes`. */
export const submissionNoteSchema = z.object({
  id: uuid,
  text: z.string(),
  actor_id: uuid,
  actor_kind: z.enum(["human", "agent"]),
  at: z.string(),
});

export type SubmissionNote = z.infer<typeof submissionNoteSchema>;

/** One photograph of a request; `thumb_url` is null where no thumbnail could be signed (a placeholder shows). */
const submissionPhotoSchema = z.object({
  id: uuid,
  name: z.string(),
  mime: z.string().nullable(),
  bytes: z.number().int().nullable(),
  sort_order: z.number().int(),
  uploaded_at: z.string().nullable(),
  thumb_url: z.string().nullable(),
});

export type SubmissionPhoto = z.infer<typeof submissionPhotoSchema>;

/** `GET /api/admin/submissions/:id`: everything submitted, the people, the photographs and the links onward. */
export const submissionDetailSchema = z.object({
  id: uuid,
  received_at: z.string(),
  workflow_state: z.enum(submissionStates),
  accepted_at: z.string().nullable(),
  decline_note: z.string().nullable(),
  duplicate_of: uuid.nullable(),
  address: z.string(),
  city: z.string(),
  state: z.enum(acceptedStates),
  zip: z.string(),
  property_type: z.enum(propertyTypes),
  price: z.number().nullable(),
  currency: z.string(),
  beds: z.number().nullable(),
  baths: z.number().nullable(),
  interior_sq_ft: z.number().nullable(),
  year_built: z.number().int().nullable(),
  year_renovated: z.number().int().nullable(),
  architect: z.string().nullable(),
  designer: z.string().nullable(),
  package: z.enum(exposurePackages),
  media_budget: z.number().nullable(),
  contact_id: uuid.nullable(),
  submitter_kind: z.enum(submitterKinds),
  submitter_name: z.string(),
  submitter_email: z.string(),
  submitter_phone: z.string().nullable(),
  brokerage: z.string().nullable(),
  listed_with_agent: z.boolean().nullable(),
  listing_agent_name: z.string().nullable(),
  listing_agent_brokerage: z.string().nullable(),
  listing_url: z.string().nullable(),
  source_url: z.string().nullable(),
  photography_url: z.string().nullable(),
  video_url: z.string().nullable(),
  story: z.string(),
  significance: z.string(),
  property_id: uuid.nullable(),
  payment_id: uuid.nullable(),
  notes: z.array(submissionNoteSchema),
  media: z.array(submissionPhotoSchema),
});

export type SubmissionDetail = z.infer<typeof submissionDetailSchema>;

/** One line of the history of a request: an audit row, or an event of a job that belongs to it. */
const timelineEntrySchema = z.object({
  source: z.enum(["audit", "job"]),
  id: z.string(),
  at: z.string(),
  /** The matrix action of an audit row, or the kind of a job event. */
  action: z.string(),
  actor_id: uuid.nullable(),
  actor_kind: z.enum(["human", "agent"]).nullable(),
  note: z.string().nullable(),
  /** The type of the job, on a job event only. */
  job_type: z.string().nullable(),
});

export type TimelineEntry = z.infer<typeof timelineEntrySchema>;

export const timelineAnswerSchema = z.object({ items: z.array(timelineEntrySchema) });
