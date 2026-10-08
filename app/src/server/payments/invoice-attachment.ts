import type { AttachmentResolver } from "../email/attachments.ts";
import { NonRetryableError } from "../jobs/types.ts";
import { fromRpcError } from "../lib/admin-errors.ts";
import { toBase64Url } from "../lib/crypto.ts";
import { ensureInvoicePdf, paymentIdOf, storageInvoiceStore } from "./invoice-pdf.ts";

// The `invoice_pdf` attachment of the `send_email` step. Jobs of one event have no order, so the email may run before
// the `invoice_pdf` job: the resolver makes the PDF itself then (same key, so the later job finds it and stops).

/** Standard base64, the form Resend's `attachments.content` takes. */
function toBase64(bytes: Uint8Array): string {
  const url = toBase64Url(bytes).replace(/-/g, "+").replace(/_/g, "/");
  return url.padEnd(Math.ceil(url.length / 4) * 4, "=");
}

export const invoicePdfAttachment: AttachmentResolver = async (ctx, data) => {
  const paymentId = paymentIdOf(data);
  const { data: rows, error } = await ctx.db
    .from("payments")
    .select("invoice_file_key, invoice_number")
    .eq("id", paymentId);
  if (error !== null) throw fromRpcError(error);
  const payment = rows[0];
  if (payment === undefined) throw new NonRetryableError("payment_missing");
  if (payment.invoice_number === null) throw new NonRetryableError("snapshot_missing");
  const store = storageInvoiceStore(ctx.db);
  const key = payment.invoice_file_key ?? (await ensureInvoicePdf(ctx.db, paymentId, store)).key;
  return { filename: `${payment.invoice_number}.pdf`, content: toBase64(await store.get(key)) };
};
