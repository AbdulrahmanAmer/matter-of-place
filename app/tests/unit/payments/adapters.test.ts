import { describe, expect, it } from "vitest";
import type { PaymentRow } from "../../../src/domain/payments";
import { AppError } from "../../../src/server/lib/errors";
import { getAdapter, registry } from "../../../src/server/payments/adapters/index";
import { StripeAdapter } from "../../../src/server/payments/adapters/stripe";
import { NotImplementedError } from "../../../src/server/payments/adapters/types";

const methods = [
  { id: "bank_transfer", label: "Bank transfer", instructions: "Account 0001" },
  { id: "wire", label: "Wire", instructions: "Routing 0002" },
];

function payment(overrides: Partial<PaymentRow> = {}): PaymentRow {
  return {
    id: "6f0d1c1e-0000-4000-8000-000000000001",
    submission_id: "6f0d1c1e-0000-4000-8000-000000000002",
    property_id: null,
    product: "The Feature",
    amount: 295,
    currency: "USD",
    method: "invoice_manual",
    invoice_number: "MOP-2026-9001",
    invoice_file_key: null,
    preferred_method: "wire",
    status: "due",
    issued_by: null,
    issued_at: "2026-10-01T12:00:00Z",
    due_at: "2026-10-15T12:00:00Z",
    paid_marked_by: null,
    paid_at: null,
    paid_method: null,
    paid_reference: null,
    waived_by: null,
    stripe_payment_intent: null,
    notes: null,
    invoice_snapshot: { instructions: methods },
    created_at: "2026-10-01T12:00:00Z",
    updated_at: "2026-10-01T12:00:00Z",
    ...overrides,
  };
}

describe("payment adapters (invariant 9)", () => {
  it("registers invoice_manual and nothing else", () => {
    expect(Object.keys(registry)).toEqual(["invoice_manual"]);
    expect(getAdapter("invoice_manual").method).toBe("invoice_manual");
  });

  it("refuses to hand out the Stripe method", () => {
    expect(() => getAdapter("stripe")).toThrow(NotImplementedError);
  });

  it("gives the instructions of the preferred method from the frozen snapshot", async () => {
    const prepared = await getAdapter("invoice_manual").prepare(payment());
    expect(prepared).toEqual({ instructions: "Wire: Routing 0002" });
  });

  it("lists every method when the preferred one is not in the snapshot", async () => {
    const prepared = await getAdapter("invoice_manual").prepare(
      payment({ preferred_method: "card_by_phone" }),
    );
    expect(prepared.instructions).toBe("Bank transfer: Account 0001\nWire: Routing 0002");
  });

  it("refuses a payment that has no invoice", () => {
    expect(() => getAdapter("invoice_manual").prepare(payment({ invoice_snapshot: null }))).toThrow(
      AppError,
    );
  });

  it("makes the Stripe stub throw NotImplementedError from every method", () => {
    const stripe = new StripeAdapter();
    expect(stripe.method).toBe("stripe");
    expect(() => stripe.prepare()).toThrow(NotImplementedError);
    expect(() => stripe.parseWebhook()).toThrow(NotImplementedError);
  });
});
