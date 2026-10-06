import { describe, expect, it } from "vitest";
import {
  actionTarget,
  allowedActions,
  type SubmissionAction,
} from "../../src/domain/admin-submissions";
import {
  canTransition,
  submissionTransitions,
  type TransitionContext,
  type WorkflowState,
} from "../../src/domain/workflow";

// B7 invariant 5: the buttons of a request are the moves B2's `canTransition` lets through, and nothing else.

const states = Object.keys(submissionTransitions).filter(
  (key): key is WorkflowState => key in submissionTransitions,
);

const fresh: TransitionContext = { acceptedAt: null, paymentStatus: null };
const accepted: TransitionContext = { acceptedAt: "2026-10-01T09:00:00Z", paymentStatus: null };
const due: TransitionContext = { acceptedAt: "2026-10-01T09:00:00Z", paymentStatus: "due" };
const paid: TransitionContext = { acceptedAt: "2026-10-01T09:00:00Z", paymentStatus: "paid" };
const contexts = [fresh, accepted, due, paid];

// The moves another slice makes: the invoice and its payment (B6), the first publication (B7 step 7, from the
// property, not from a request button) and the distribution states (B10, G60).
const otherOwners: readonly string[] = [
  "Accepted>Invoice Issued",
  "Invoice Issued>Invoice Issued",
  "Invoice Issued>Scheduled",
  "Scheduled>Published",
  "Published>Distribution Active",
  "Published>Completed",
  "Distribution Active>Completed",
];

describe("allowedActions", () => {
  it("offers, in every state, a button for each move canTransition allows and that B7 owns", () => {
    const gaps: string[] = [];
    for (const from of states) {
      for (const ctx of contexts) {
        const offered = new Set(
          allowedActions(from, ctx).map((action) => actionTarget(action, from, ctx)),
        );
        const allowed = states.filter(
          (to) => canTransition(from, to, ctx) && !otherOwners.includes(`${from}>${to}`),
        );
        // `assets_received` takes an accepted request back to Accepted and any other back to review: one button.
        const expected = allowed.filter(
          (to) =>
            !(
              from === "Awaiting Assets" &&
              to === (ctx.acceptedAt === null ? "Accepted" : "Under Review")
            ),
        );
        const missing = expected.filter((to) => !offered.has(to));
        const extra = [...offered].filter((to) => to === null || !expected.includes(to));
        if (missing.length > 0 || extra.length > 0) {
          gaps.push(
            `${from} ${JSON.stringify(ctx)}: missing ${missing.join("|")} extra ${extra.join("|")}`,
          );
        }
      }
    }
    expect(gaps).toEqual([]);
  });

  it("offers only actions whose move canTransition lets through", () => {
    const refused: string[] = [];
    for (const from of states) {
      for (const ctx of contexts) {
        for (const action of allowedActions(from, ctx)) {
          const to = actionTarget(action, from, ctx);
          if (to === null || !canTransition(from, to, ctx)) refused.push(`${from} ${action}`);
        }
      }
    }
    expect(refused).toEqual([]);
  });

  it("matches the buttons screen 4 draws for each state", () => {
    const table = (ctx: TransitionContext) =>
      Object.fromEntries(states.map((state) => [state, allowedActions(state, ctx)]));
    const none: SubmissionAction[] = [];
    expect(table(fresh)).toEqual({
      Submitted: ["start_review"],
      "Under Review": ["decline", "accept", "request_assets"],
      Accepted: ["request_assets", "withdraw"],
      Declined: none,
      "Awaiting Assets": ["assets_received", "withdraw"],
      "Invoice Issued": ["withdraw"],
      Scheduled: none,
      Published: none,
      "Distribution Active": none,
      Completed: none,
      Withdrawn: none,
    });
    expect(table(paid)).toEqual({
      ...table(accepted),
      Accepted: ["request_assets"],
      "Awaiting Assets": ["assets_received"],
      "Invoice Issued": none,
    });
    expect(table(due)["Invoice Issued"]).toEqual(["withdraw"]);
    expect(actionTarget("assets_received", "Awaiting Assets", fresh)).toBe("Under Review");
    expect(actionTarget("assets_received", "Awaiting Assets", accepted)).toBe("Accepted");
  });
});
