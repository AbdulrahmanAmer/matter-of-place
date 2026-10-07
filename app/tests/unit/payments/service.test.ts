import "../../fixtures/worker-env";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database, Tables } from "../../../src/db";
import { appRoles } from "../../../src/domain/contracts";
import { requiredInvoiceFields, sqlAssignedFields } from "../../../src/domain/payments";
import type { AdminActor } from "../../../src/server/lib/admin-route";
import type { AppRole } from "../../../src/server/lib/authz";
import { buildInvoiceSnapshot } from "../../../src/server/payments/invoice-snapshot";
import { priceFor } from "../../../src/server/payments/pricing";
import {
  activate,
  getPayment,
  issueInvoice,
  listPayments,
  markPaid,
  voidInvoice,
  waive,
  waiveWithoutInvoice,
} from "../../../src/server/payments/service";
import { validIssueInvoice } from "../../fixtures/builders";
import { fakeDb, type FakeDb, type FakeDbOptions } from "../../fixtures/fake-db";
import {
  PAYMENT_ID,
  PROPERTY_ID,
  STAMP,
  SUBMISSION_ID,
  paymentRow,
  submissionRow,
} from "../automation/fixtures/entity-rows";

// B6 step 3: the payments service. Every case runs with a `fetch` that throws (invariant 6) and with `fanoutEvent`
// and `enqueueJob` replaced by spies, so the tests see the fan-out on the RPC's event and no job enqueued in a request.

const fanout = vi.hoisted(() => vi.fn((_db: unknown, _eventId: string) => Promise.resolve(1)));
const enqueue = vi.hoisted(() => vi.fn((_db: unknown, _input: unknown) => Promise.resolve("job")));

vi.mock(import("../../../src/server/automation/fanout.ts"), () => ({ fanoutEvent: fanout }));
vi.mock(import("../../../src/server/lib/jobs.ts"), () => ({ enqueueJob: enqueue }));

const EVENT_ID = "6b2e0a00-0000-4000-8000-0000000000e1";
const JOB_ID = "6b2e0a00-0000-4000-8000-0000000000f1";
const COPY_JOB_ID = "6b2e0a00-0000-4000-8000-0000000000f2";
const USER_ID = "6b2e0a00-0000-4000-8000-0000000000a1";

const outside = vi.fn((_input: unknown) => {
  throw new Error("outside call in a request");
});

const person = (roles: AppRole[]): AdminActor => ({
  userId: USER_ID,
  kind: "human",
  roles,
  scopes: [],
  requestId: "req-payments-unit",
});
const agent: AdminActor = {
  userId: USER_ID,
  kind: "agent",
  roles: appRoles,
  scopes: ["payments", "submissions"],
  requestId: "req-payments-unit",
};
const editor = person(["managing_editor"]);
const admin = person(["admin"]);

const site = {
  contact: { email: "hello@example.invalid", phone: null, privacy_email: null },
  legal: { entity: "Example Media LLC", address: "100 Example Street, New York, NY 10001" },
  social: {},
};

const invoiceSettings = {
  prefix: "MOP",
  due_days: 14,
  terms: "Payable within 14 days of the invoice date.",
  late_terms: "Overdue amounts may be subject to a late charge.",
  tax_line: "No sales tax is charged on this invoice.",
  payment_methods: [
    { id: "bank_transfer", label: "Bank transfer", instructions: "Account 000 at Example Bank." },
  ],
  campaign_days: {
    "The Feature": null,
    "The Reach": null,
    "The Campaign": 14,
    "Five Features": null,
  },
  billing_email: "billing@example.invalid",
};

type InvoiceSettings = typeof invoiceSettings;

function settingsRows(
  invoice: Partial<InvoiceSettings> = {},
  legal: Partial<typeof site.legal> = {},
): Tables<"settings">[] {
  return [
    {
      key: "site",
      value: { ...site, legal: { ...site.legal, ...legal } },
      updated_at: STAMP,
      updated_by: null,
    },
    {
      key: "invoice",
      value: { ...invoiceSettings, ...invoice },
      updated_at: STAMP,
      updated_by: null,
    },
  ];
}

function jobRow(): Tables<"jobs"> {
  return {
    attempts: 0,
    created_at: STAMP,
    error: null,
    event_id: EVENT_ID,
    finished_at: null,
    heavy: false,
    id: JOB_ID,
    idempotency_key: `send_email:${EVENT_ID}`,
    locked_at: null,
    locked_by: null,
    max_attempts: 5,
    msg_id: null,
    payload: {},
    recipe_id: null,
    result: null,
    run_after: STAMP,
    run_local: false,
    status: "queued",
    step_id: null,
    type: "send_email",
    updated_at: STAMP,
    job_event_entity_id: null,
  };
}

const wrote = () => [{ payment_id: PAYMENT_ID, event_id: EVENT_ID }];
const raised = (code: string) => Object.assign(new Error(code), { code: "P0001" });

function paymentsDb(rpc: FakeDbOptions["rpc"] = {}, tables: FakeDbOptions["tables"] = {}): FakeDb {
  return fakeDb({
    rpc,
    tables: {
      settings: settingsRows(),
      submissions: [submissionRow({ accepted_at: STAMP, workflow_state: "Accepted" })],
      jobs: [jobRow()],
      ...tables,
    },
  });
}

const rpcCalls = (db: FakeDb, name: string): unknown[] =>
  db.calls.filter((call) => call.kind === "rpc" && call.name === name).map((call) => call.args[0]);

/** "<status> <code>" of a thrown `AppError`. */
function described(error: unknown): string {
  if (typeof error !== "object" || error === null) return String(error);
  const status: unknown = "status" in error ? error.status : null;
  const code: unknown = "code" in error ? error.code : null;
  return `${String(status)} ${String(code)}`;
}

const refusal = (action: Promise<unknown>): Promise<string> =>
  action.then(
    () => "resolved",
    (error: unknown) => described(error),
  );

const expectedJobs = [{ id: JOB_ID, type: "send_email", status: "queued" }];

beforeEach(() => {
  vi.stubGlobal("fetch", outside);
  fanout.mockClear();
  enqueue.mockClear();
  outside.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("issueInvoice", () => {
  it("issues for a managing_editor at the priceFor amount, stripping a client amount, and answers the event's jobs", async () => {
    const db = paymentsDb({ issue_invoice: wrote });
    const body = { ...validIssueInvoice(), amount: 1 };
    const answer = await issueInvoice(editor, db, body);
    expect(answer).toEqual({ payment_id: PAYMENT_ID, event_id: EVENT_ID, jobs: expectedJobs });
    const [args] = rpcCalls(db, "issue_invoice");
    const amount: unknown =
      typeof args === "object" && args !== null && "p_amount" in args ? args.p_amount : null;
    expect({ calls: rpcCalls(db, "issue_invoice").length, amount }).toEqual({
      calls: 1,
      amount: priceFor("The Feature"),
    });
    expect(fanout.mock.calls.map(([, eventId]) => eventId)).toEqual([EVENT_ID]);
  });

  it("refuses commercial with 403 forbidden before any database call", async () => {
    const db = paymentsDb({ issue_invoice: wrote });
    expect(await refusal(issueInvoice(person(["commercial"]), db, validIssueInvoice()))).toBe(
      "403 forbidden",
    );
    expect(db.calls).toEqual([]);
  });

  it("refuses a request that is not accepted with 409 not_accepted and issues nothing", async () => {
    const db = paymentsDb(
      { issue_invoice: wrote },
      { submissions: [submissionRow({ accepted_at: null, workflow_state: "Under Review" })] },
    );
    expect(await refusal(issueInvoice(editor, db, validIssueInvoice()))).toBe("409 not_accepted");
    expect(rpcCalls(db, "issue_invoice")).toEqual([]);
  });

  it("refuses unready settings with 409 invoice_not_ready naming each blank setting", async () => {
    const db = paymentsDb(
      { issue_invoice: wrote },
      {
        settings: settingsRows(
          { late_terms: " ", tax_line: "", terms: "", payment_methods: [] },
          { address: "" },
        ),
      },
    );
    const failure: unknown = await issueInvoice(editor, db, validIssueInvoice()).catch(
      (error: unknown) => error,
    );
    const issues: unknown =
      typeof failure === "object" && failure !== null && "issues" in failure
        ? failure.issues
        : null;
    const paths = Array.isArray(issues)
      ? issues.map((issue: unknown) =>
          typeof issue === "object" && issue !== null && "path" in issue ? String(issue.path) : "",
        )
      : [];
    expect(described(failure)).toBe("409 invoice_not_ready");
    expect(paths).toEqual([
      "legal,address",
      "payment_methods,instructions",
      "terms",
      "late_terms",
      "tax_line",
    ]);
    expect(rpcCalls(db, "issue_invoice")).toEqual([]);
  });

  it("still answers when the fan-out throws, and logs fanout_failed", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    fanout.mockRejectedValueOnce(new Error("planner down"));
    const answer = await issueInvoice(
      editor,
      paymentsDb({ issue_invoice: wrote }),
      validIssueInvoice(),
    );
    expect(answer).toEqual({ payment_id: PAYMENT_ID, event_id: EVENT_ID, jobs: expectedJobs });
    expect(warn.mock.calls.map(([line]) => String(line).includes("fanout_failed"))).toEqual([true]);
  });
});

describe("buildInvoiceSnapshot", () => {
  const submission = submissionRow({ submitter_name: "Ada Owner", brokerage: null });
  const sqlAssigned: readonly string[] = sqlAssignedFields;

  it("fills every required field but the number and the two dates from complete settings", async () => {
    const snapshot = await buildInvoiceSnapshot(
      fakeDb({ tables: { settings: settingsRows() } }),
      submission,
      "The Reach",
      "bank_transfer",
    );
    const missing = requiredInvoiceFields.filter(
      (field) => !sqlAssigned.includes(field) && !(field in snapshot),
    );
    expect(missing).toEqual([]);
    expect(snapshot).toMatchObject({
      entity: site.legal.entity,
      address: site.legal.address,
      amount: priceFor("The Reach"),
      currency: "USD",
      tax_line: invoiceSettings.tax_line,
      late_terms: invoiceSettings.late_terms,
      instructions: invoiceSettings.payment_methods,
      bill_to: { name: "Ada Owner" },
    });
  });

  it("throws snapshot_incomplete:late_terms when late_terms is blank", async () => {
    const db = fakeDb({ tables: { settings: settingsRows({ late_terms: "" }) } });
    await expect(
      buildInvoiceSnapshot(db, submission, "The Feature", "bank_transfer"),
    ).rejects.toThrow("snapshot_incomplete:late_terms");
  });
});

describe("markPaid, waive and voidInvoice", () => {
  const paidAt = "2026-10-01T12:00:00Z";

  it("marks paid, fans out once on the returned event and answers its jobs", async () => {
    const db = paymentsDb({ mark_payment_paid: wrote });
    const answer = await markPaid(editor, db, {
      id: PAYMENT_ID,
      paidAt,
      method: "Bank transfer",
      reference: "REF-1",
    });
    expect(answer).toEqual({ payment_id: PAYMENT_ID, event_id: EVENT_ID, jobs: expectedJobs });
    expect(fanout.mock.calls.map(([, eventId]) => eventId)).toEqual([EVENT_ID]);
  });

  it("refuses a payment date one hour ahead with 422 and makes no RPC call", async () => {
    const db = paymentsDb({ mark_payment_paid: wrote });
    const ahead = new Date(Date.now() + 3_600_000).toISOString();
    expect(
      await refusal(markPaid(editor, db, { id: PAYMENT_ID, paidAt: ahead, method: "Wire" })),
    ).toBe("422 paid_at_future");
    expect(rpcCalls(db, "mark_payment_paid")).toEqual([]);
  });

  it("answers 409 wrong_state when the RPC raises it", async () => {
    const db = paymentsDb({ mark_payment_paid: () => raised("wrong_state") });
    expect(await refusal(markPaid(editor, db, { id: PAYMENT_ID, paidAt, method: "Wire" }))).toBe(
      "409 wrong_state",
    );
    expect(fanout).not.toHaveBeenCalled();
  });

  it("waives with a reason, and refuses a missing reason with 422", async () => {
    const db = paymentsDb({ waive_payment: wrote });
    const answer = await waive(editor, db, { id: PAYMENT_ID, reason: "Comp for a partner" });
    expect(answer.event_id).toBe(EVENT_ID);
    expect(await refusal(waive(editor, db, { id: PAYMENT_ID }))).toBe("422 validation");
    expect(rpcCalls(db, "waive_payment")).toHaveLength(1);
  });

  it("voids for an admin and fans out on exactly the event_id the RPC returned", async () => {
    const db = paymentsDb({ void_payment: wrote });
    const answer = await voidInvoice(admin, db, { id: PAYMENT_ID, reason: "Issued twice" });
    expect(answer).toEqual({ payment_id: PAYMENT_ID, event_id: EVENT_ID, jobs: expectedJobs });
    expect(fanout.mock.calls.map(([, eventId]) => eventId)).toEqual([EVENT_ID]);
  });

  it("refuses void to a managing_editor with 403, and a 2-character reason with 422", async () => {
    const db = paymentsDb({ void_payment: wrote });
    expect(await refusal(voidInvoice(editor, db, { id: PAYMENT_ID, reason: "Issued twice" }))).toBe(
      "403 forbidden",
    );
    expect(await refusal(voidInvoice(admin, db, { id: PAYMENT_ID, reason: "no" }))).toBe(
      "422 validation",
    );
    expect(rpcCalls(db, "void_payment")).toEqual([]);
  });
});

describe("waiveWithoutInvoice (DL-01)", () => {
  it("records one waiver at the priceFor amount and issues no invoice", async () => {
    const db = paymentsDb({ record_waiver: wrote });
    const answer = await waiveWithoutInvoice(editor, db, {
      id: SUBMISSION_ID,
      product: "The Reach",
      reason: "Five Features credit",
    });
    expect(answer).toEqual({ payment_id: PAYMENT_ID, event_id: EVENT_ID, jobs: expectedJobs });
    expect(rpcCalls(db, "record_waiver")).toEqual([
      {
        p_submission_id: SUBMISSION_ID,
        p_product: "The Reach",
        p_amount: priceFor("The Reach"),
        p_reason: "Five Features credit",
        p_actor: USER_ID,
        p_actor_kind: "human",
        p_request_id: "req-payments-unit",
      },
    ]);
    expect(fanout.mock.calls.map(([, eventId]) => eventId)).toEqual([EVENT_ID]);
  });

  it("refuses Not sure yet and a 2-character reason with 422", async () => {
    const db = paymentsDb({ record_waiver: wrote });
    const outcomes = [
      await refusal(
        waiveWithoutInvoice(editor, db, {
          id: SUBMISSION_ID,
          product: "Not sure yet",
          reason: "Comp",
        }),
      ),
      await refusal(
        waiveWithoutInvoice(editor, db, {
          id: SUBMISSION_ID,
          product: "The Feature",
          reason: "ok",
        }),
      ),
    ];
    expect(outcomes).toEqual(["422 validation", "422 validation"]);
    expect(rpcCalls(db, "record_waiver")).toEqual([]);
  });
});

describe("activate", () => {
  it("answers the property, the event's jobs and the copy job, with no Storage call", async () => {
    const db = paymentsDb({
      activate_submission: () => [
        { property_id: PROPERTY_ID, event_id: EVENT_ID, copy_job_id: COPY_JOB_ID },
      ],
    });
    const answer = await activate(editor, db, { id: SUBMISSION_ID });
    expect(answer).toEqual({
      property_id: PROPERTY_ID,
      event_id: EVENT_ID,
      jobs: expectedJobs,
      copy_job_id: COPY_JOB_ID,
    });
    expect(db.calls.filter((call) => call.kind === "storage")).toEqual([]);
    expect(fanout.mock.calls.map(([, eventId]) => eventId)).toEqual([EVENT_ID]);
  });

  it("answers a second activate with the same property, no event and no jobs", async () => {
    let calls = 0;
    const db = paymentsDb({
      activate_submission: () => {
        calls += 1;
        const row = { property_id: PROPERTY_ID, event_id: EVENT_ID, copy_job_id: COPY_JOB_ID };
        // The generated type says string; SQL returns a null event on the idempotent second call.
        if (calls > 1) Reflect.set(row, "event_id", null);
        return [row];
      },
    });
    await activate(editor, db, { id: SUBMISSION_ID });
    const second = await activate(editor, db, { id: SUBMISSION_ID });
    expect(second).toEqual({
      property_id: PROPERTY_ID,
      event_id: null,
      jobs: [],
      copy_job_id: COPY_JOB_ID,
    });
    expect(fanout).toHaveBeenCalledTimes(1);
  });
});

describe("the agent guardrail and invariant 6", () => {
  it("lets an agent with scope issue and refuses it human_only on mark-paid, waive, void, activate and a waiver", async () => {
    const db = paymentsDb({ issue_invoice: wrote });
    const issued = await refusal(issueInvoice(agent, db, validIssueInvoice()));
    const refused = [
      await refusal(markPaid(agent, db, { id: PAYMENT_ID, paidAt: STAMP, method: "Wire" })),
      await refusal(waive(agent, db, { id: PAYMENT_ID, reason: "Comp" })),
      await refusal(voidInvoice(agent, db, { id: PAYMENT_ID, reason: "Twice" })),
      await refusal(activate(agent, db, { id: SUBMISSION_ID })),
      await refusal(
        waiveWithoutInvoice(agent, db, {
          id: SUBMISSION_ID,
          product: "The Feature",
          reason: "Comp",
        }),
      ),
    ];
    expect({ issued, refused }).toEqual({
      issued: "resolved",
      refused: Array.from({ length: 5 }, () => "403 human_only"),
    });
  });

  it("makes no outside call and enqueues no job in any action", async () => {
    const db = paymentsDb({
      issue_invoice: wrote,
      mark_payment_paid: wrote,
      waive_payment: wrote,
      record_waiver: wrote,
      void_payment: wrote,
      activate_submission: () => [
        { property_id: PROPERTY_ID, event_id: EVENT_ID, copy_job_id: COPY_JOB_ID },
      ],
    });
    await issueInvoice(editor, db, validIssueInvoice());
    await markPaid(editor, db, { id: PAYMENT_ID, paidAt: STAMP, method: "Wire" });
    await waive(editor, db, { id: PAYMENT_ID, reason: "Comp" });
    await waiveWithoutInvoice(editor, db, {
      id: SUBMISSION_ID,
      product: "The Feature",
      reason: "Comp",
    });
    await voidInvoice(admin, db, { id: PAYMENT_ID, reason: "Twice" });
    await activate(editor, db, { id: SUBMISSION_ID });
    expect({
      outside: outside.mock.calls.length,
      enqueued: enqueue.mock.calls.length,
      fanouts: fanout.mock.calls.length,
    }).toEqual({ outside: 0, enqueued: 0, fanouts: 6 });
  });
});

describe("listPayments and getPayment", () => {
  type ListedRow = Database["public"]["Views"]["invoice_list"]["Row"];
  const listed = (overrides: Partial<ListedRow> = {}): ListedRow => ({
    id: PAYMENT_ID,
    invoice_number: "MOP-2026-0001",
    submission_id: SUBMISSION_ID,
    submitter_name: "Ada Owner",
    submitter_email: "owner@fixtures.invalid",
    product: "The Feature",
    amount: 295,
    status: "due",
    issued_at: "2026-10-01T09:00:00.123456+00:00",
    due_at: "2026-10-15T09:00:00.123456+00:00",
    paid_at: null,
    overdue: false,
    days_open: 6,
    ...overrides,
  });

  it("answers one page with the cursor of the row it ends on, and refuses a broken cursor with 422", async () => {
    const db = fakeDb({ tables: { invoice_list: [listed(), listed({ id: SUBMISSION_ID })] } });
    const page = await listPayments(editor, db, { limit: 1, status: "due" });
    expect(page).toEqual({
      items: [listed()],
      next_cursor: `2026-10-01T09:00:00.123456+00:00~${PAYMENT_ID}`,
    });
    expect(await refusal(listPayments(editor, db, { cursor: "yesterday" }))).toBe("422 validation");
  });

  it("answers 404 for an unknown payment and the row with its snapshot otherwise", async () => {
    const row = paymentRow({ invoice_snapshot: { invoice_number: "MOP-2026-0001" } });
    expect(
      await getPayment(person(["commercial"]), fakeDb({ tables: { payments: [row] } }), {
        id: PAYMENT_ID,
      }),
    ).toEqual(row);
    expect(
      await refusal(getPayment(admin, fakeDb({ tables: { payments: [] } }), { id: PAYMENT_ID })),
    ).toBe("404 not_found");
  });
});
