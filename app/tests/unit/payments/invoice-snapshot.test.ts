// B18 step 3: an invoice and a waiver carry the price of the stored plan (H80), read straight from `settings` in the
// same select as the identity, found by the id each product is bound to, and frozen at issue.
import "../../fixtures/worker-env";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Json, Tables } from "../../../src/db";
import { invoiceLine, type ProductPlan } from "../../../src/domain/exposure";
import type { AdminActor } from "../../../src/server/lib/admin-route";
import { buildInvoiceSnapshot } from "../../../src/server/payments/invoice-snapshot";
import { issueInvoice, waiveWithoutInvoice } from "../../../src/server/payments/service";
import { seedProducts } from "../../../src/server/settings/products";
import { validIssueInvoice } from "../../fixtures/builders";
import { fakeDb, type FakeDb } from "../../fixtures/fake-db";
import { stateJson } from "../../fixtures/snapshot";
import {
  PAYMENT_ID,
  STAMP,
  SUBMISSION_ID,
  paymentRow,
  submissionRow,
} from "../automation/fixtures/entity-rows";

const fanout = vi.hoisted(() => vi.fn((_db: unknown, _eventId: string) => Promise.resolve(0)));
vi.mock(import("../../../src/server/automation/fanout.ts"), () => ({ fanoutEvent: fanout }));

const EVENT_ID = "6b2e0a00-0000-4000-8000-0000000000e2";
const editor: AdminActor = {
  userId: "6b2e0a00-0000-4000-8000-0000000000a2",
  kind: "human",
  roles: ["managing_editor"],
  scopes: [],
  requestId: "req-invoice-snapshot",
};

const site = {
  contact: { email: "hello@example.invalid", phone: null, privacy_email: null },
  legal: { entity: "Example Media LLC", address: "100 Example Street, New York, NY 10001" },
  social: {},
};
const invoice = {
  prefix: "MOP",
  due_days: 14,
  terms: "Payable within 14 days of the invoice date.",
  late_terms: "Overdue amounts may be subject to a late charge.",
  tax_line: "No sales tax is charged on this invoice.",
  payment_methods: [{ id: "bank_transfer", label: "Bank transfer", instructions: "Account 000." }],
  campaign_days: {
    "The Feature": null,
    "The Reach": null,
    "The Campaign": 14,
    "Five Features": null,
  },
  billing_email: "billing@example.invalid",
};

/** The seed with The Feature at $325 and The Reach renamed and at $725, as an admin would store it. */
const stored = (): ProductPlan[] =>
  seedProducts().map((plan) => {
    if (plan.id === "feature") return { ...plan, price: 325, line: "Editorial presence, kept." };
    if (plan.id === "reach") return { ...plan, name: "The Wider Reach", price: 725 };
    return plan;
  });

const row = (key: string, value: NonNullable<Json>): Tables<"settings"> => ({
  key,
  value,
  updated_at: STAMP,
  updated_by: null,
});

function settings(products?: NonNullable<Json>): Tables<"settings">[] {
  const rows = [row("site", site), row("invoice", invoice)];
  return products === undefined ? rows : [...rows, row("products", products)];
}

const submission = submissionRow({ submitter_name: "Ada Owner", brokerage: null });

const logged: string[] = [];

beforeEach(() => {
  vi.stubGlobal("fetch", () => {
    throw new Error("outside call in a request");
  });
  fanout.mockClear();
  logged.length = 0;
  vi.spyOn(console, "warn").mockImplementation((line: unknown) => {
    logged.push(String(line));
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the invoice snapshot of a stored plan", () => {
  it("carries the stored plan's amount and invoiceLine", async () => {
    const snapshot = await buildInvoiceSnapshot(
      fakeDb({ tables: { settings: settings({ plans: stored() }) } }),
      submission,
      "The Feature",
      "bank_transfer",
    );
    expect({ description: snapshot.description, amount: snapshot.amount }).toEqual({
      description: "The Feature. Editorial presence, kept.",
      amount: 325,
    });
  });

  it("carries the seed when the products row is absent", async () => {
    const snapshot = await buildInvoiceSnapshot(
      fakeDb({ tables: { settings: settings() } }),
      submission,
      "The Feature",
      "bank_transfer",
    );
    expect({ description: snapshot.description, amount: snapshot.amount }).toEqual({
      description: "The Feature. Editorial presence.",
      amount: 295,
    });
  });

  it("carries the seed, with one products_invalid line, when the stored value does not parse", async () => {
    const snapshot = await buildInvoiceSnapshot(
      fakeDb({ tables: { settings: settings({ plans: stored().slice(0, 3) }) } }),
      submission,
      "The Feature",
      "bank_transfer",
    );
    expect(snapshot.amount).toBe(295);
    expect(logged.filter((line) => line.includes("products_invalid"))).toHaveLength(1);
  });

  it("reads the plans straight from the table, never through the public-state memo", async () => {
    const memo = stored().map((plan) => ({ ...plan, price: 999 }));
    const db = fakeDb({
      rpc: { public_state: () => stateJson(5, { products: { plans: memo } }) },
      tables: { settings: settings({ plans: stored() }) },
    });
    const snapshot = await buildInvoiceSnapshot(db, submission, "The Feature", "bank_transfer");
    expect(snapshot.amount).toBe(325);
    expect(db.calls.map((call) => `${call.kind} ${call.name}`)).toEqual(["from settings"]);
  });

  it("finds the plan by its bound id, so a renamed plan invoices at its stored price", async () => {
    const plans = stored();
    const reach = plans.find((plan) => plan.id === "reach");
    if (reach === undefined) throw new Error("no reach plan");
    const snapshot = await buildInvoiceSnapshot(
      fakeDb({ tables: { settings: settings({ plans }) } }),
      submission,
      "The Reach",
      "bank_transfer",
    );
    expect({ description: snapshot.description, amount: snapshot.amount }).toEqual({
      description: invoiceLine(reach),
      amount: 725,
    });
  });
});

describe("issuing and waiving at the stored price", () => {
  function paymentsDb(issued: Tables<"payments">): FakeDb {
    return fakeDb({
      rpc: {
        issue_invoice: () => [{ payment_id: PAYMENT_ID, event_id: EVENT_ID }],
        record_waiver: () => [{ payment_id: PAYMENT_ID, event_id: EVENT_ID }],
      },
      tables: {
        settings: settings({ plans: stored() }),
        submissions: [submissionRow({ accepted_at: STAMP, workflow_state: "Accepted" })],
        jobs: [],
        payments: [issued],
      },
    });
  }

  const argsOf = (db: FakeDb, name: string): unknown =>
    db.calls.find((call) => call.kind === "rpc" && call.name === name)?.args[0];

  it("issues at the stored price and neither reads nor changes a payment row already written", async () => {
    const issued = paymentRow({ amount: 295, product: "The Feature" });
    const before = structuredClone(issued);
    const db = paymentsDb(issued);
    await issueInvoice(editor, db, validIssueInvoice());
    expect(argsOf(db, "issue_invoice")).toMatchObject({
      p_amount: 325,
      p_snapshot: { amount: 325 },
    });
    expect(db.calls.filter((call) => call.name === "payments")).toEqual([]);
    expect(issued).toEqual(before);
  });

  it("records a waiver at the stored price of the renamed plan", async () => {
    const db = paymentsDb(paymentRow());
    await waiveWithoutInvoice(editor, db, {
      id: SUBMISSION_ID,
      product: "The Reach",
      reason: "Five Features credit",
    });
    expect(argsOf(db, "record_waiver")).toMatchObject({ p_product: "The Reach", p_amount: 725 });
  });
});
