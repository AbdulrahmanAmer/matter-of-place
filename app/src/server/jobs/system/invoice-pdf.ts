import { ensureInvoicePdf, paymentIdOf, storageInvoiceStore } from "../../payments/invoice-pdf.ts";
import type { SystemJobDefinition } from "../types.ts";

// The invoice PDF job (B6), started only by `issue_invoice` with the key `invoice_pdf:<payment_id>`. It makes the
// PDF from the frozen snapshot and stores it in the private bucket; a Storage or network error is thrown, so B8's
// backoff retries it and screen 16 shows it after the last attempt.
export const invoicePdf: SystemJobDefinition = {
  type: "invoice_pdf",
  sideEffect: "sql_guard",
  maxAttempts: 12,
  async run(ctx, _params, data) {
    const { key, existed } = await ensureInvoicePdf(
      ctx.db,
      paymentIdOf(data),
      storageInvoiceStore(ctx.db),
    );
    return { status: "done", result: existed ? { key, skipped: "exists" } : { key } };
  },
};
