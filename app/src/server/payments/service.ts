import { z, type ZodType, type ZodTypeDef } from "zod";
import { adminPageSchema } from "../../domain/admin-page.ts";
import {
  issueInvoiceInput,
  markPaidInput,
  paidAtIsFuture,
  voidInput,
  waiveInput,
  waiveWithoutInvoiceInput,
  type PaymentRow,
} from "../../domain/payments.ts";
import type { PaymentStatus } from "../../domain/rows.ts";
import { fanoutEvent } from "../automation/fanout.ts";
import { fromRpcError } from "../lib/admin-errors.ts";
import type { AdminActor } from "../lib/admin-route.ts";
import { auditContext, type AuditArgs } from "../lib/audit.ts";
import { authorize } from "../lib/authz.ts";
import type { Db } from "../lib/db.ts";
import { AppError, fromZod } from "../lib/errors.ts";
import { logLine } from "../lib/log.ts";
import { assertInvoiceReady, buildInvoiceSnapshot } from "./invoice-snapshot.ts";
import { priceFor } from "./pricing.ts";

// Invoices and payments from `/admin` (B6 screens 5 and 6). Each action: authorize, parse, then one RPC that writes
// the row, the audit row and the event in one transaction (and, for an issue, the `invoice_pdf` job), then the event's
// fan-out, best effort, and one read of the jobs it planned. Nothing outside the database is called in a request
// (invariant 6): the runner renders the PDF, sends the email and copies the photographs.

const id = z.string().uuid();
const statuses = [
  "due",
  "paid",
  "waived",
  "refunded",
  "void",
] as const satisfies readonly PaymentStatus[];

/** A path's `:id`, merged into every input by `defineAdminRoute`. */
export const pathId = z.object({ id });
export const markPaidRequest = markPaidInput.extend({ id });
export const waiveRequest = waiveInput.extend({ id });
export const voidRequest = voidInput.extend({ id });
/** `POST /api/admin/submissions/:id/waive`: `id` is the submission (invariant 12). */
export const waiveWithoutInvoiceRequest = waiveWithoutInvoiceInput.extend({ id });
export const listPaymentsInput = adminPageSchema.extend({
  status: z.enum(statuses).optional(),
  // A query string says "true"; the service parses the route's output again, which is already a boolean.
  overdue: z
    .preprocess(
      (value) => (value === "true" ? true : value === "false" ? false : value),
      z.boolean(),
    )
    .optional(),
});

interface PlannedJob {
  id: string;
  type: string;
  status: string;
}

export interface PaymentAnswer {
  payment_id: string;
  event_id: string;
  jobs: PlannedJob[];
}

export interface ActivateAnswer {
  property_id: string;
  /** Null, with no jobs, on the idempotent second call. */
  event_id: string | null;
  jobs: PlannedJob[];
  /** The `copy_submission_media` job that copies the photographs (E2E-02); null once B8's prune removed it. */
  copy_job_id: string | null;
}

/** The service parses again, so a caller other than the route gets the same 422 the route gives. */
function parse<T>(schema: ZodType<T, ZodTypeDef, unknown>, raw: unknown): T {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw fromZod(parsed.error);
  return parsed.data;
}

/** Plans the event's jobs now, best effort (the runner's sweep is the safety net), then reads them once. */
async function plannedJobs(db: Db, eventId: string): Promise<PlannedJob[]> {
  try {
    await fanoutEvent(db, eventId);
  } catch (failure) {
    logLine("warn", "fanout_failed", {
      eventId,
      code: failure instanceof AppError ? failure.code : "server",
    });
  }
  const { data, error } = await db.from("jobs").select("id, type, status").eq("event_id", eventId);
  if (error !== null) throw fromRpcError(error);
  return data.map((job) => ({ id: job.id, type: job.type, status: job.status }));
}

const written = z.array(z.object({ payment_id: z.string(), event_id: z.string() }));

async function answer(db: Db, result: { data: unknown; error: unknown }): Promise<PaymentAnswer> {
  if (result.error !== null) throw fromRpcError(result.error);
  const [row] = written.parse(result.data);
  if (row === undefined) throw new AppError("server", undefined, "The change returned no row.");
  return { ...row, jobs: await plannedJobs(db, row.event_id) };
}

/** The parse, readiness, snapshot, the issue and its fan-out: everything of an issue below authorization. */
async function issueInvoiceCore(db: Db, raw: unknown, audit: AuditArgs): Promise<PaymentAnswer> {
  const input = parse(issueInvoiceInput, raw);
  const { data, error } = await db
    .from("submissions")
    .select(
      "id, accepted_at, submitter_name, submitter_email, brokerage, address, city, state, zip",
    )
    .eq("id", input.submissionId);
  if (error !== null) throw fromRpcError(error);
  const submission = data[0];
  if (submission === undefined) {
    throw new AppError("not_found", undefined, "This request does not exist.");
  }
  if (submission.accepted_at === null) {
    throw new AppError("not_accepted", undefined, "Accept this request before issuing an invoice.");
  }
  await assertInvoiceReady(db);
  const snapshot = await buildInvoiceSnapshot(db, submission, input.product, input.preferredMethod);
  return answer(
    db,
    await db.rpc("issue_invoice", {
      p_submission_id: input.submissionId,
      p_product: input.product,
      p_amount: priceFor(input.product),
      p_preferred_method: input.preferredMethod,
      p_snapshot: snapshot,
      ...audit,
    }),
  );
}

const invoiceListRow = z.object({
  id: z.string(),
  invoice_number: z.string().nullable(),
  submission_id: z.string(),
  submitter_name: z.string(),
  submitter_email: z.string(),
  product: z.string(),
  amount: z.number(),
  status: z.enum(statuses),
  issued_at: z.string().nullable(),
  due_at: z.string().nullable(),
  paid_at: z.string().nullable(),
  overdue: z.boolean().nullable(),
  days_open: z.number().nullable(),
});

const CURSOR = /^(null|d{4}-dd-ddT[d:.]+(?:Z|[+-]dd:dd))~([0-9a-f-]{36})$/;

type ListInput = z.output<typeof listPaymentsInput>;
type InvoiceListRow = z.infer<typeof invoiceListRow>;

function filtered(db: Db, input: ListInput) {
  let query = db.from("invoice_list").select("*");
  if (input.status !== undefined) query = query.eq("status", input.status);
  if (input.overdue !== undefined) query = query.eq("overdue", input.overdue);
  return query;
}

async function newestFirst(
  query: ReturnType<typeof filtered>,
  take: number,
): Promise<InvoiceListRow[]> {
  const { data, error } = await query
    .order("issued_at", { ascending: false, nullsFirst: false })
    .order("id", { ascending: false })
    .limit(take);
  if (error !== null) throw fromRpcError(error);
  return z.array(invoiceListRow).parse(data);
}

/** The rows after the cursor's `(issued_at, id)`, with only AND filters (R44): its ties, then older, then unissued. */
async function after(db: Db, input: ListInput, cursor: string, take: number) {
  const [, at, id] = CURSOR.exec(cursor) ?? [];
  if (at === undefined || id === undefined) {
    throw new AppError("validation", undefined, "This page link is no longer valid.");
  }
  if (at === "null") {
    return newestFirst(filtered(db, input).is("issued_at", null).lt("id", id), take);
  }
  const rows = [
    ...(await newestFirst(filtered(db, input).eq("issued_at", at).lt("id", id), take)),
    ...(await newestFirst(filtered(db, input).lt("issued_at", at), take)),
  ];
  if (rows.length >= take) return rows;
  return [...rows, ...(await newestFirst(filtered(db, input).is("issued_at", null), take))];
}

/** `GET /api/admin/payments`: newest issue first, waivers without an invoice last (keyset, invariant 17c). */
export async function listPayments(
  actor: AdminActor,
  db: Db,
  raw: unknown,
): Promise<{ items: InvoiceListRow[]; next_cursor: string | null }> {
  authorize(actor, "payments.list");
  const input = parse(listPaymentsInput, raw);
  const take = input.limit + 1;
  const rows =
    input.cursor === undefined
      ? await newestFirst(filtered(db, input), take)
      : await after(db, input, input.cursor, take);
  const items = rows.slice(0, input.limit);
  const last = items.at(-1);
  return {
    items,
    next_cursor:
      rows.length > input.limit && last !== undefined
        ? `${last.issued_at ?? "null"}~${last.id}`
        : null,
  };
}

/** `GET /api/admin/payments/:id`: the row with its frozen `invoice_snapshot`. */
export async function getPayment(actor: AdminActor, db: Db, raw: unknown): Promise<PaymentRow> {
  authorize(actor, "payments.get");
  const input = parse(pathId, raw);
  const { data, error } = await db.from("payments").select("*").eq("id", input.id);
  if (error !== null) throw fromRpcError(error);
  const row = data[0];
  if (row === undefined) throw new AppError("not_found", undefined, "This payment does not exist.");
  return row;
}

/** `POST /api/admin/payments/issue-invoice`. A client `amount` is stripped by the parse: the price is `priceFor`. */
export async function issueInvoice(
  actor: AdminActor,
  db: Db,
  raw: unknown,
): Promise<PaymentAnswer> {
  authorize(actor, "payments.issue");
  return issueInvoiceCore(db, raw, auditContext(actor));
}

/** `POST /api/admin/payments/:id/mark-paid`. A future date is refused here, before the RPC (invariant 3). */
export async function markPaid(actor: AdminActor, db: Db, raw: unknown): Promise<PaymentAnswer> {
  authorize(actor, "payments.mark_paid");
  const input = parse(markPaidRequest, raw);
  if (paidAtIsFuture(input.paidAt, new Date())) {
    throw new AppError("paid_at_future", undefined, "The payment date cannot be in the future.");
  }
  return answer(
    db,
    await db.rpc("mark_payment_paid", {
      p_payment_id: input.id,
      p_paid_at: input.paidAt,
      p_method: input.method,
      p_reference: input.reference ?? "",
      ...auditContext(actor),
    }),
  );
}

/** `POST /api/admin/payments/:id/waive`: a due invoice is not owed after all. */
export async function waive(actor: AdminActor, db: Db, raw: unknown): Promise<PaymentAnswer> {
  authorize(actor, "payments.waive");
  const input = parse(waiveRequest, raw);
  return answer(
    db,
    await db.rpc("waive_payment", {
      p_payment_id: input.id,
      p_reason: input.reason,
      ...auditContext(actor),
    }),
  );
}

/** `POST /api/admin/submissions/:id/waive`: a credit or a comp, recorded with no invoice (DL-01, invariant 12). */
export async function waiveWithoutInvoice(
  actor: AdminActor,
  db: Db,
  raw: unknown,
): Promise<PaymentAnswer> {
  authorize(actor, "payments.waive");
  const input = parse(waiveWithoutInvoiceRequest, raw);
  return answer(
    db,
    await db.rpc("record_waiver", {
      p_submission_id: input.id,
      p_product: input.product,
      p_amount: priceFor(input.product),
      p_reason: input.reason,
      ...auditContext(actor),
    }),
  );
}

/** `POST /api/admin/payments/:id/void`: a due invoice withdrawn; the submission may be invoiced again. */
export async function voidInvoice(actor: AdminActor, db: Db, raw: unknown): Promise<PaymentAnswer> {
  authorize(actor, "payments.void");
  const input = parse(voidRequest, raw);
  return answer(
    db,
    await db.rpc("void_payment", {
      p_payment_id: input.id,
      p_reason: input.reason,
      ...auditContext(actor),
    }),
  );
}

const activated = z.array(
  z.object({
    property_id: z.string(),
    event_id: z.string().nullable(),
    copy_job_id: z.string().nullable(),
  }),
);

/**
 * `POST /api/admin/submissions/:id/activate`. It copies no photograph: `activate_submission` reaches
 * `create_property_from_submission`, which enqueues `copy_submission_media` in the same transaction, so the
 * request costs the same calls for one photograph as for forty (E2E-02, PERF-07).
 */
export async function activate(actor: AdminActor, db: Db, raw: unknown): Promise<ActivateAnswer> {
  authorize(actor, "submissions.activate");
  const input = parse(pathId, raw);
  const { data, error } = await db.rpc("activate_submission", {
    p_submission_id: input.id,
    ...auditContext(actor),
  });
  if (error !== null) throw fromRpcError(error);
  const [row] = activated.parse(data);
  if (row === undefined) throw new AppError("server", undefined, "The change returned no row.");
  return {
    ...row,
    jobs: row.event_id === null ? [] : await plannedJobs(db, row.event_id),
  };
}

/** `GET /api/admin/payments/:id/pdf`: a 60 second signed URL of the PDF in the private bucket `documents`. */
export async function getPdf(actor: AdminActor, db: Db, raw: unknown): Promise<string> {
  authorize(actor, "payments.pdf");
  const input = parse(pathId, raw);
  const { data, error } = await db.from("payments").select("invoice_file_key").eq("id", input.id);
  if (error !== null) throw fromRpcError(error);
  const row = data[0];
  if (row === undefined) throw new AppError("not_found", undefined, "This payment does not exist.");
  if (row.invoice_file_key === null) {
    throw new AppError("pdf_not_ready", undefined, "The PDF is still being made.");
  }
  // STUB(B6 step 5): invoiceSignedUrl of invoice-pdf.ts replaces this call
  const signed = await db.storage.from("documents").createSignedUrl(row.invoice_file_key, 60);
  if (signed.error !== null) {
    throw new AppError("storage_unavailable", undefined, "File storage is not answering.");
  }
  return signed.data.signedUrl;
}
