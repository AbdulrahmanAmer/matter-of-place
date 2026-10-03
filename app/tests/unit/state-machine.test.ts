// Invariant 5 against the spec: the matrix below is written by hand from diagram 1 of 03-diagrams/plans-b.md plus the
// moves the plans add to it (reissue F16, Published to Completed DL-09, Withdrawn DL-04). It does not read
// `submissionTransitions`; workflow.test.ts and tests/db/gate.db.test.ts compare the implementation with the database.
import { describe, expect, it } from "vitest";
import {
  canTransition,
  gateReason,
  type TransitionContext,
  type WorkflowState,
} from "../../src/domain/workflow";

const order: readonly WorkflowState[] = [
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
];

// A row is a `from` state, a column the `to` state in the order above, "1" a move the spec allows.
const grid: Record<WorkflowState, string> = {
  //                       Sub Rev Acc Dec Awa Inv Sch Pub Dis Com Wit
  Submitted: /*          */ "0 1 0 0 0 0 0 0 0 0 0",
  "Under Review": /*     */ "0 0 1 1 1 0 0 0 0 0 0",
  Accepted: /*           */ "0 0 0 0 1 1 0 0 0 0 1",
  Declined: /*           */ "0 0 0 0 0 0 0 0 0 0 0",
  "Awaiting Assets": /*  */ "0 1 1 0 0 0 0 0 0 0 1",
  "Invoice Issued": /*   */ "0 0 0 0 0 1 1 0 0 0 1",
  Scheduled: /*          */ "0 0 0 0 0 0 0 1 0 0 0",
  Published: /*          */ "0 0 0 0 0 0 0 0 1 1 0",
  "Distribution Active": "0 0 0 0 0 0 0 0 0 1 0",
  Completed: /*          */ "0 0 0 0 0 0 0 0 0 0 0",
  Withdrawn: /*          */ "0 0 0 0 0 0 0 0 0 0 0",
};

const SET = "2026-10-01T00:00:00Z";
const payments: TransitionContext["paymentStatus"][] = [null, "due", "paid", "waived", "refunded"];
const contexts: TransitionContext[] = [null, SET].flatMap((acceptedAt) =>
  payments.map((paymentStatus) => ({ acceptedAt, paymentStatus })),
);
const named = (ctx: TransitionContext) =>
  `${ctx.acceptedAt === null ? "not accepted" : "accepted"}, payment ${String(ctx.paymentStatus)}`;

const inGraph = (from: WorkflowState, to: WorkflowState) =>
  grid[from].split(" ").at(order.indexOf(to)) === "1";

/** Moves with no gate besides the graph. */
const ungated: [WorkflowState, WorkflowState][] = [
  ["Submitted", "Under Review"],
  ["Under Review", "Declined"],
  ["Under Review", "Awaiting Assets"],
  ["Under Review", "Accepted"],
  ["Accepted", "Awaiting Assets"],
  ["Awaiting Assets", "Under Review"],
  ["Awaiting Assets", "Accepted"],
];
/** Moves into a state that needs `accepted_at` and nothing else. */
const needAcceptance: [WorkflowState, WorkflowState][] = [
  ["Accepted", "Invoice Issued"],
  ["Invoice Issued", "Invoice Issued"],
  ["Scheduled", "Published"],
  ["Published", "Distribution Active"],
  ["Published", "Completed"],
  ["Distribution Active", "Completed"],
];
const withdrawals: [WorkflowState, WorkflowState][] = [
  ["Accepted", "Withdrawn"],
  ["Awaiting Assets", "Withdrawn"],
  ["Invoice Issued", "Withdrawn"],
];

describe("submission state machine against the spec", () => {
  it("holds a matrix row for each of the eleven states", () => {
    expect(Object.keys(grid).sort()).toEqual([...order].sort());
    expect(Object.values(grid).map((row) => row.split(" ").length)).toEqual(order.map(() => 11));
  });

  it("allows exactly the pairs of the matrix, in every acceptance and payment context", () => {
    const wrong = order.flatMap((from) =>
      order.flatMap((to) =>
        contexts
          .filter((ctx) => (gateReason(from, to, ctx) !== "graph") !== inGraph(from, to))
          .map((ctx) => `${from}>${to} (${named(ctx)})`),
      ),
    );
    expect(wrong).toEqual([]);
  });

  it("lets a move with no gate through in every context", () => {
    const refused = ungated.flatMap(([from, to]) =>
      contexts
        .filter((ctx) => !canTransition(from, to, ctx))
        .map((ctx) => `${from}>${to} (${named(ctx)})`),
    );
    expect(refused).toEqual([]);
  });

  it("refuses Invoice Issued and every later state without acceptance, whatever the payment", () => {
    const wrong = needAcceptance.flatMap(([from, to]) =>
      contexts
        .filter((ctx) => canTransition(from, to, ctx) !== (ctx.acceptedAt !== null))
        .map((ctx) => `${from}>${to} (${named(ctx)})`),
    );
    expect(wrong).toEqual([]);
  });

  it("allows Scheduled only when accepted and the payment is paid or waived", () => {
    // payments in the order null, due, paid, waived, refunded
    const expected = {
      "not accepted": [false, false, false, false, false],
      accepted: [false, false, true, true, false],
    };
    const observed = {
      "not accepted": payments.map((paymentStatus) =>
        canTransition("Invoice Issued", "Scheduled", { acceptedAt: null, paymentStatus }),
      ),
      accepted: payments.map((paymentStatus) =>
        canTransition("Invoice Issued", "Scheduled", { acceptedAt: SET, paymentStatus }),
      ),
    };
    expect(observed).toEqual(expected);
  });

  it("refuses Withdrawn once a payment is paid or waived, and needs no acceptance", () => {
    // payments in the order null, due, paid, waived, refunded
    const expected = [true, true, false, false, true];
    const observed = withdrawals.flatMap(([from, to]) =>
      [null, SET].map((acceptedAt) => ({
        move: `${from}>${to} (${acceptedAt === null ? "not accepted" : "accepted"})`,
        allowed: payments.map((paymentStatus) =>
          canTransition(from, to, { acceptedAt, paymentStatus }),
        ),
      })),
    );
    expect(observed.filter((row) => row.allowed.join() !== expected.join())).toEqual([]);
  });
});
