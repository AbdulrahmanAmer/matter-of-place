// Invariants 5 and 21: the two graphs of src/domain/workflow.ts. tests/db/gate.db.test.ts compares them with the
// database functions pair by pair.
import { describe, expect, it } from "vitest";
import {
  canTransition,
  gateReason,
  propertyEditorialTransitions,
  submissionTransitions,
  type TransitionContext,
  type WorkflowState,
} from "../../src/domain/workflow";

const states = Object.keys(submissionTransitions).filter(
  (state): state is WorkflowState => state in submissionTransitions,
);
const accepted: TransitionContext = { acceptedAt: "2026-10-01T00:00:00Z", paymentStatus: "due" };
const TERMINAL: readonly WorkflowState[] = ["Declined", "Withdrawn", "Completed"];

/** Every state reachable from `from` through the graph, `from` included. */
function reachable(from: WorkflowState): Set<WorkflowState> {
  const seen = new Set<WorkflowState>([from]);
  const queue: WorkflowState[] = [from];
  for (let state = queue.shift(); state !== undefined; state = queue.shift()) {
    const next: readonly WorkflowState[] = submissionTransitions[state];
    for (const to of next) {
      if (!seen.has(to)) {
        seen.add(to);
        queue.push(to);
      }
    }
  }
  return seen;
}

describe("submission graph", () => {
  it("holds the eleven states of submission_state", () => {
    expect(states).toEqual([
      "Submitted",
      "Under Review",
      "Accepted",
      "Declined",
      "Awaiting Assets",
      "Invoice Issued",
      "Scheduled",
      "Published",
      "Distribution Active",
      "Completed",
      "Withdrawn",
    ]);
  });

  it("refuses a move that skips review", () => {
    expect({
      submittedToAccepted: canTransition("Submitted", "Accepted", accepted),
      submittedToReview: canTransition("Submitted", "Under Review", accepted),
      acceptedToScheduled: gateReason("Accepted", "Scheduled", accepted),
    }).toEqual({
      submittedToAccepted: false,
      submittedToReview: true,
      acceptedToScheduled: "graph",
    });
  });

  it("a terminal state is reachable from every state (DL-04, DL-09)", () => {
    const stuck = states.filter((from) => !TERMINAL.some((end) => reachable(from).has(end)));
    expect(stuck).toEqual([]);
  });

  it("a terminal state has no way out", () => {
    expect(TERMINAL.map((state) => submissionTransitions[state].length)).toEqual([0, 0, 0]);
  });

  it("Invoice Issued and later need acceptance", () => {
    const none: TransitionContext = { acceptedAt: null, paymentStatus: "paid" };
    expect({
      invoice: gateReason("Accepted", "Invoice Issued", none),
      reissue: gateReason("Invoice Issued", "Invoice Issued", none),
      accept: gateReason("Under Review", "Accepted", none),
      invoiceAccepted: gateReason("Accepted", "Invoice Issued", accepted),
    }).toEqual({
      invoice: "not_accepted",
      reissue: "not_accepted",
      accept: null,
      invoiceAccepted: null,
    });
  });

  it("Scheduled needs a paid or waived payment, Withdrawn refuses one", () => {
    const at = accepted.acceptedAt;
    const scheduled = (paymentStatus: TransitionContext["paymentStatus"]) =>
      gateReason("Invoice Issued", "Scheduled", { acceptedAt: at, paymentStatus });
    const withdrawn = (paymentStatus: TransitionContext["paymentStatus"]) =>
      gateReason("Invoice Issued", "Withdrawn", { acceptedAt: at, paymentStatus });
    expect({
      scheduled: [
        scheduled(null),
        scheduled("due"),
        scheduled("refunded"),
        scheduled("paid"),
        scheduled("waived"),
      ],
      withdrawn: [withdrawn(null), withdrawn("due"), withdrawn("paid"), withdrawn("waived")],
    }).toEqual({
      scheduled: ["not_paid", "not_paid", "not_paid", null, null],
      withdrawn: [null, null, "paid", "paid"],
    });
  });

  it("the moves B6, B7 and B10 make are in the graph (F16, G60, DL-04, DL-09)", () => {
    const paid: TransitionContext = { acceptedAt: accepted.acceptedAt, paymentStatus: "paid" };
    expect([
      canTransition("Invoice Issued", "Invoice Issued", accepted),
      canTransition("Published", "Distribution Active", paid),
      canTransition("Distribution Active", "Completed", paid),
      canTransition("Published", "Completed", paid),
      canTransition("Accepted", "Withdrawn", accepted),
      canTransition("Awaiting Assets", "Withdrawn", accepted),
      canTransition("Invoice Issued", "Withdrawn", accepted),
    ]).toEqual([true, true, true, true, true, true, true]);
  });
});

describe("property editorial graph", () => {
  it("allows exactly the moves of invariant 21", () => {
    const moves = Object.entries(propertyEditorialTransitions).flatMap(([from, to]) =>
      to.map((next) => `${from}>${next}`),
    );
    expect(moves.sort()).toEqual(
      [
        "draft>review",
        "draft>agent_review",
        "review>draft",
        "review>agent_review",
        "review>published",
        "agent_review>review",
        "agent_review>draft",
        "agent_review>published",
        "published>archived",
        "archived>draft",
        "draft>archived",
        "review>archived",
        "agent_review>archived",
      ].sort(),
    );
  });
});
