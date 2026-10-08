import { NonRetryableError, type JsonObject } from "../jobs/types.ts";
import { fromRpcError } from "../lib/admin-errors.ts";
import type { Db } from "../lib/db.ts";
import { AppError } from "../lib/errors.ts";
import { themeRgb } from "../../templates/theme.gen.ts";
import {
  invoiceSnapshotSchema,
  layoutInvoice,
  newInvoiceDocument,
  PAGE,
  type InvoiceSnapshot,
} from "./invoice-layout.ts";

// The invoice PDF (B6 step 5): made from the frozen snapshot by the `invoice_pdf` job or, when an email needs it
// first, by the attachment resolver; stored in the private bucket `documents` (ruling H33 (1)), never in `media`.

export const INVOICE_BUCKET = "documents";

/** A place the PDF bytes live: the bucket `documents` in production, a map in the tests. */
export interface PdfStore {
  put(path: string, bytes: Uint8Array): Promise<void>;
  get(path: string): Promise<Uint8Array>;
}

/** The PDF of one snapshot. The same snapshot gives the same bytes: no clock time is stamped, the one date is the issue date. */
export async function renderInvoicePdf(snapshot: InvoiceSnapshot): Promise<Uint8Array> {
  const runs = await layoutInvoice(snapshot);
  const { doc, fonts } = await newInvoiceDocument();
  const { rgb } = await import("pdf-lib");
  doc.setTitle(`Invoice ${snapshot.invoice_number}`);
  doc.setAuthor(snapshot.entity);
  doc.setCreationDate(new Date(`${snapshot.issue_date}T00:00:00Z`));
  const page = doc.addPage([PAGE.width, PAGE.height]);
  for (const run of runs) {
    const [red, green, blue] = themeRgb[run.color];
    page.drawText(run.text, {
      x: run.x,
      y: run.y,
      size: run.size,
      font: fonts[run.font],
      color: rgb(red, green, blue),
    });
  }
  return doc.save();
}

/** The job data's `payment_id`; a job without one has no payment to render. */
export function paymentIdOf(data: JsonObject): string {
  const paymentId = data["payment_id"];
  if (typeof paymentId !== "string") throw new NonRetryableError("payment_missing");
  return paymentId;
}

/**
 * Makes the PDF of a payment once. A payment whose key is set is left alone; otherwise the snapshot is rendered,
 * stored at `<year>/<invoice_number>.pdf` and the path recorded by `set_invoice_key`, which keeps the first key when
 * two renders finish together.
 */
export async function ensureInvoicePdf(
  db: Db,
  paymentId: string,
  store: PdfStore,
): Promise<{ key: string; existed: boolean }> {
  const { data, error } = await db
    .from("payments")
    .select("invoice_file_key, invoice_snapshot")
    .eq("id", paymentId);
  if (error !== null) throw fromRpcError(error);
  const row = data[0];
  if (row === undefined) throw new NonRetryableError("payment_missing");
  if (row.invoice_file_key !== null) return { key: row.invoice_file_key, existed: true };
  if (row.invoice_snapshot === null) throw new NonRetryableError("snapshot_missing");
  const snapshot = invoiceSnapshotSchema.safeParse(row.invoice_snapshot);
  if (!snapshot.success) throw new NonRetryableError("snapshot_invalid");
  const path = `${snapshot.data.issue_date.slice(0, 4)}/${snapshot.data.invoice_number}.pdf`;
  await store.put(path, await renderInvoicePdf(snapshot.data));
  const recorded = await db.rpc("set_invoice_key", { p_payment_id: paymentId, p_key: path });
  if (recorded.error !== null) throw fromRpcError(recorded.error);
  return { key: recorded.data, existed: false };
}

function alreadyExists(error: {
  message: string;
  status?: number | undefined;
  statusCode?: string | undefined;
}): boolean {
  return (
    error.status === 409 || error.statusCode === "409" || /already exists/i.test(error.message)
  );
}

/** The private bucket through the service-role client. A Storage or network error is thrown as it came. */
export function storageInvoiceStore(db: Db): PdfStore {
  return {
    async put(path, bytes) {
      const { error } = await db.storage
        .from(INVOICE_BUCKET)
        .upload(path, bytes, { contentType: "application/pdf", upsert: false });
      if (error !== null && !alreadyExists(error)) throw error;
    },
    async get(path) {
      const { data, error } = await db.storage.from(INVOICE_BUCKET).download(path);
      if (error !== null) throw error;
      return new Uint8Array(await data.arrayBuffer());
    },
  };
}

/** `GET /api/admin/payments/:id/pdf`: a link that works for 60 seconds, made at the click. */
export async function invoiceSignedUrl(db: Db, path: string): Promise<string> {
  const { data, error } = await db.storage.from(INVOICE_BUCKET).createSignedUrl(path, 60);
  if (error !== null) {
    throw new AppError("storage_unavailable", undefined, "File storage is not answering.");
  }
  return data.signedUrl;
}
