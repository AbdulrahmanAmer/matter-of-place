// Invoices and payments (B6, architecture 3.4). Field names are the API JSON and the database columns (G-004);
// `settings.invoice` keeps its snake_case keys because the jsonb value and this schema are the same shape.
import { z } from "zod";
import { exposurePackages } from "./contracts.ts";
import type { PaymentStatus } from "./rows.ts";

export type { PaymentRow } from "./rows.ts";

/** A product that can be invoiced: every `exposure_package` except `Not sure yet`, which has no price. */
const invoiceProduct = z.enum(exposurePackages).exclude(["Not sure yet"]);
type InvoiceProduct = z.infer<typeof invoiceProduct>;

const reason = z.string().trim().min(3).max(500);
const methodId = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/);

/** The body of `payments.issue-invoice`. There is no amount key: the price comes from `priceFor`, and the parse strips one. */
export const issueInvoiceInput = z.object({
  submissionId: z.string().uuid(),
  product: invoiceProduct,
  preferredMethod: methodId,
});
export type IssueInvoiceInput = z.infer<typeof issueInvoiceInput>;

/** The body of `payments.mark-paid`. A date in the future is refused by `paidAtIsFuture` before the RPC. */
export const markPaidInput = z.object({
  paidAt: z.string().datetime({ offset: true }),
  method: z.string().trim().min(1).max(60),
  reference: z.string().trim().max(200).optional(),
});

export const waiveInput = z.object({ reason });

/** A waiver recorded without an invoice (DL-01): the product it covers and why. */
export const waiveWithoutInvoiceInput = z.object({ product: invoiceProduct, reason });

export const voidInput = z.object({ reason });

/** The request is the caller's clock: the domain reads no wall time (R29), so `now` is passed in. */
export function paidAtIsFuture(paidAt: string, now: Date): boolean {
  return Date.parse(paidAt) > now.getTime();
}

/** One way to pay, as `settings.invoice.payment_methods` lists it and as the invoice snapshot freezes it. */
export const paymentMethodSchema = z.object({
  id: methodId,
  label: z.string().trim().min(1).max(60),
  instructions: z.string().trim().max(2000),
});

const days = z.number().int().positive().nullable();

/** A campaign window in days per product, null where the exposure page states none (invariant 13). */
export const campaignDaysSchema = z
  .object({ "The Feature": days, "The Reach": days, "The Campaign": days, "Five Features": days })
  .strict();

/** `settings.invoice`. Blank terms pass here and are refused at issue time as `invoice_not_ready`. */
export const invoiceSettingsSchema = z.object({
  prefix: z.string().regex(/^[A-Z0-9]{2,8}$/),
  due_days: z.number().int().min(1).max(365),
  terms: z.string().trim().max(1000),
  late_terms: z.string().trim().max(1000),
  tax_line: z.string().trim().max(500),
  payment_methods: z
    .array(paymentMethodSchema)
    .max(10)
    .refine((methods) => new Set(methods.map((method) => method.id)).size === methods.length, {
      message: "Each payment method needs its own id.",
    }),
  campaign_days: campaignDaysSchema,
  billing_email: z.string().email().max(254),
});

/** What an issued invoice must show (GP-06, architecture 10); `layoutInvoice` and `buildInvoiceSnapshot` check it. */
export const requiredInvoiceFields = [
  "entity",
  "address",
  "invoice_number",
  "issue_date",
  "due_date",
  "description",
  "amount",
  "currency",
  "tax_line",
  "instructions",
  "late_terms",
] as const;

/** The snapshot fields SQL fills inside `issue_invoice`: the number and the two dates. */
export const sqlAssignedFields = ["invoice_number", "issue_date", "due_date"] as const;

export const paymentStatusLabels: Record<PaymentStatus, string> = {
  due: "Due",
  paid: "Paid",
  waived: "Waived",
  refunded: "Refunded",
  void: "Void",
};

/** Invariant 3: a payment leaves `due` once and never moves again. `refunded` is not reachable in this slice. */
export const paymentTransitions = {
  due: ["paid", "waived", "void"],
  paid: [],
  waived: [],
  refunded: [],
  void: [],
} as const satisfies Record<PaymentStatus, readonly PaymentStatus[]>;

const tiers: Record<InvoiceProduct, "Feature" | "Reach" | "Campaign"> = {
  "The Feature": "Feature",
  "Five Features": "Feature",
  "The Reach": "Reach",
  "The Campaign": "Campaign",
};

/** The TS mirror of SQL `payment_tier`: what B8b's `conditions.tiers` matches. A Five Features credit buys one Feature. */
export function tierOf(product: InvoiceProduct): "Feature" | "Reach" | "Campaign" {
  return tiers[product];
}
