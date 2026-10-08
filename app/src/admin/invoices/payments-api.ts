import { z } from "zod";
import { invoiceListSchema, invoiceSnapshotSchema, paymentStatuses } from "../../domain/payments";
import { adminFetch } from "../ui/admin-fetch";

// The browser side of screens 5 and 6. Components reach these through `payments-queries.ts`.

const paymentSchema = z.object({
  id: z.string(),
  submission_id: z.string(),
  property_id: z.string().nullable(),
  product: z.string(),
  amount: z.number(),
  status: z.enum(paymentStatuses),
  invoice_number: z.string().nullable(),
  invoice_file_key: z.string().nullable(),
  invoice_snapshot: invoiceSnapshotSchema.nullable(),
  preferred_method: z.string().nullable(),
  issued_at: z.string().nullable(),
  due_at: z.string().nullable(),
  paid_at: z.string().nullable(),
  paid_method: z.string().nullable(),
  paid_reference: z.string().nullable(),
  notes: z.string().nullable(),
});

export type Payment = z.infer<typeof paymentSchema>;

const jobs = z.array(z.object({ id: z.string(), type: z.string(), status: z.string() }));

const writeAnswerSchema = z.object({ payment_id: z.string(), event_id: z.string(), jobs });

const activateAnswerSchema = z.object({
  property_id: z.string(),
  event_id: z.string().nullable(),
  jobs,
  copy_job_id: z.string().nullable(),
});

export type WriteAnswer = z.infer<typeof writeAnswerSchema>;

const paymentPath = (id: string) => `/api/admin/payments/${id}`;

function post<T>(path: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>, body: unknown) {
  return adminFetch(path, schema, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** One page of invoices; `query` holds the filters and the cursor exactly as the address has them. */
export function fetchPayments(query: Readonly<Record<string, string>>) {
  const search = new URLSearchParams(query).toString();
  return adminFetch(`/api/admin/payments${search === "" ? "" : `?${search}`}`, invoiceListSchema);
}

export function fetchPayment(id: string) {
  return adminFetch(paymentPath(id), paymentSchema);
}

/** There is no amount: the server prices the product. */
export function issueInvoice(input: {
  submissionId: string;
  product: string;
  preferredMethod: string;
}) {
  return post("/api/admin/payments/issue-invoice", writeAnswerSchema, input);
}

export function markPaid(
  id: string,
  input: { paidAt: string; method: string; reference?: string },
) {
  return post(`${paymentPath(id)}/mark-paid`, writeAnswerSchema, input);
}

export function waive(id: string, reason: string) {
  return post(`${paymentPath(id)}/waive`, writeAnswerSchema, { reason });
}

export function voidInvoice(id: string, reason: string) {
  return post(`${paymentPath(id)}/void`, writeAnswerSchema, { reason });
}

/** A credit or a comp, recorded for a request with no invoice (invariant 12). */
export function waiveWithoutInvoice(
  submissionId: string,
  input: { product: string; reason: string },
) {
  return post(`/api/admin/submissions/${submissionId}/waive`, writeAnswerSchema, input);
}

export function activate(submissionId: string) {
  return post(`/api/admin/submissions/${submissionId}/activate`, activateAnswerSchema, {});
}
