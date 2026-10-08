import { describe, expect, it } from "vitest";
import {
  campaignDaysSchema,
  invoiceSettingsSchema,
  issueInvoiceInput,
  markPaidInput,
  paidAtIsFuture,
  paymentStatusLabels,
  paymentTransitions,
  requiredInvoiceFields,
  sqlAssignedFields,
  voidInput,
  waiveInput,
  waiveWithoutInvoiceInput,
} from "../../../src/domain/payments";
import { validIssueInvoice } from "../../fixtures/builders";

const settings = {
  prefix: "MOP",
  due_days: 14,
  terms: "Payable within 14 days of the invoice date.",
  late_terms: "Payment is due by the date shown.",
  tax_line: "No sales tax is charged on this invoice.",
  payment_methods: [{ id: "wire", label: "Wire", instructions: "Routing 0002" }],
  campaign_days: {
    "The Feature": null,
    "The Reach": null,
    "The Campaign": 14,
    "Five Features": null,
  },
  billing_email: "billing@fixtures.invalid",
};

describe("payments domain schemas", () => {
  it("strips an amount sent with the issue input and refuses Not sure yet", () => {
    const parsed = issueInvoiceInput.parse({ ...validIssueInvoice(), amount: 1 });
    expect(parsed).toEqual(validIssueInvoice());
    const unresolved = issueInvoiceInput.safeParse({
      ...validIssueInvoice(),
      product: "Not sure yet",
    });
    expect(unresolved.success).toBe(false);
  });

  it("bounds a reason to 3 to 500 characters on waive, void and a waiver without an invoice", () => {
    const accepts = (reason: string) =>
      [
        waiveInput.safeParse({ reason }).success,
        voidInput.safeParse({ reason }).success,
        waiveWithoutInvoiceInput.safeParse({ product: "Five Features", reason }).success,
      ].every(Boolean);
    expect([
      accepts("ab"),
      accepts("abc"),
      accepts("a".repeat(500)),
      accepts("a".repeat(501)),
    ]).toEqual([false, true, true, false]);
    const unresolved = waiveWithoutInvoiceInput.safeParse({
      product: "Not sure yet",
      reason: "Credit",
    });
    expect(unresolved.success).toBe(false);
  });

  it("takes a payment date with an offset and finds one later than now", () => {
    const now = new Date("2026-10-07T12:00:00Z");
    const dateOnly = markPaidInput.safeParse({ paidAt: "2026-10-07", method: "wire" });
    const withOffset = markPaidInput.safeParse({ paidAt: "2026-10-07T09:00:00Z", method: "wire" });
    expect([dateOnly.success, withOffset.success]).toEqual([false, true]);
    expect([
      paidAtIsFuture("2026-10-07T12:00:01Z", now),
      paidAtIsFuture("2026-10-07T12:00:00Z", now),
      paidAtIsFuture("2026-10-07T14:30:00+03:00", now),
    ]).toEqual([true, false, false]);
  });

  it("names exactly the four products in campaign_days, each a positive whole number or null", () => {
    expect(Object.keys(campaignDaysSchema.shape)).toEqual([
      "The Feature",
      "The Reach",
      "The Campaign",
      "Five Features",
    ]);
    const days = settings.campaign_days;
    expect(campaignDaysSchema.safeParse(days).success).toBe(true);
    expect(campaignDaysSchema.safeParse({ ...days, "The Reach": 0 }).success).toBe(false);
    expect(campaignDaysSchema.safeParse({ ...days, "Not sure yet": 7 }).success).toBe(false);
  });

  it("accepts the seeded invoice settings and refuses a repeated method id or a long billing email", () => {
    expect(invoiceSettingsSchema.safeParse(settings).success).toBe(true);
    const twice = [...settings.payment_methods, ...settings.payment_methods];
    expect(invoiceSettingsSchema.safeParse({ ...settings, payment_methods: twice }).success).toBe(
      false,
    );
    const long = `${"a".repeat(250)}@fixtures.invalid`;
    expect(invoiceSettingsSchema.safeParse({ ...settings, billing_email: long }).success).toBe(
      false,
    );
  });

  it("lets a payment leave due only, once, and labels every status", () => {
    expect(paymentTransitions).toEqual({
      due: ["paid", "waived", "void"],
      paid: [],
      waived: [],
      refunded: [],
      void: [],
    });
    expect(Object.keys(paymentStatusLabels)).toEqual(Object.keys(paymentTransitions));
  });

  it("keeps the fields SQL assigns inside the required invoice fields", () => {
    const outside = sqlAssignedFields.filter((field) => !requiredInvoiceFields.includes(field));
    expect(outside).toEqual([]);
  });
});
