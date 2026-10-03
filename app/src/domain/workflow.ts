// The two state graphs of the database, declared once (STANDARDS R22). `submission_transition_allowed` and
// `editorial_transition_allowed` hold the same tables, and tests/db/gate.db.test.ts compares every pair.

/**
 * Invariant 5 and diagram 1 of `03-diagrams/plans-b.md`. `Invoice Issued` to itself is the reissue after a void (B6);
 * `Published` goes to `Completed` directly when no post was ever made (DL-09); `Withdrawn` is terminal (DL-04).
 */
export const submissionTransitions = {
  Submitted: ["Under Review"],
  "Under Review": ["Declined", "Awaiting Assets", "Accepted"],
  Accepted: ["Awaiting Assets", "Invoice Issued", "Withdrawn"],
  Declined: [],
  "Awaiting Assets": ["Under Review", "Accepted", "Withdrawn"],
  "Invoice Issued": ["Invoice Issued", "Scheduled", "Withdrawn"],
  Scheduled: ["Published"],
  Published: ["Distribution Active", "Completed"],
  "Distribution Active": ["Completed"],
  Completed: [],
  Withdrawn: [],
} as const satisfies Record<string, readonly string[]>;

export type WorkflowState = keyof typeof submissionTransitions;

type PaymentStatus = "due" | "paid" | "waived" | "refunded";

/** What the gate reads besides the graph: the acceptance time and the best payment status of the request. */
export interface TransitionContext {
  acceptedAt: string | null;
  paymentStatus: PaymentStatus | null;
}

/** Why `enforce_editorial_gate` refuses a move; every refusal raises `wrong_state`. */
type GateReason = "graph" | "not_accepted" | "not_paid" | "paid";

const NEEDS_ACCEPTANCE: readonly WorkflowState[] = [
  "Invoice Issued",
  "Scheduled",
  "Published",
  "Distribution Active",
  "Completed",
];

const settled = (status: PaymentStatus | null) => status === "paid" || status === "waived";

/** The reason a move is refused, or null when `enforce_editorial_gate` lets it through. */
export function gateReason(
  from: WorkflowState,
  to: WorkflowState,
  ctx: TransitionContext,
): GateReason | null {
  const next: readonly WorkflowState[] = submissionTransitions[from];
  if (!next.includes(to)) return "graph";
  if (NEEDS_ACCEPTANCE.includes(to) && ctx.acceptedAt === null) return "not_accepted";
  if (to === "Scheduled" && !settled(ctx.paymentStatus)) return "not_paid";
  if (to === "Withdrawn" && settled(ctx.paymentStatus)) return "paid";
  return null;
}

export function canTransition(
  from: WorkflowState,
  to: WorkflowState,
  ctx: TransitionContext,
): boolean {
  return gateReason(from, to, ctx) === null;
}

/** Invariant 21 (DL-03). An update that keeps the state is not a move and always passes. */
export const propertyEditorialTransitions = {
  draft: ["review", "agent_review", "archived"],
  review: ["draft", "agent_review", "published", "archived"],
  agent_review: ["review", "draft", "published", "archived"],
  published: ["archived"],
  archived: ["draft"],
} as const satisfies Record<string, readonly string[]>;
