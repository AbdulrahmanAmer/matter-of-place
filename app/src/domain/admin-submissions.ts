import { z } from "zod";
import { ADMIN_PAGE_MAX, adminPageAnswer, adminPageSchema } from "./admin-page.ts";
import { acceptedStates, exposurePackages, submissionStates, submitterKinds } from "./contracts.ts";
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
