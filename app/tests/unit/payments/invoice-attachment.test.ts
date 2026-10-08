import { describe, expect, it } from "vitest";
import { attachmentResolvers } from "../../../src/server/email/attachments";
import { NonRetryableError } from "../../../src/server/jobs/types";
import { invoicePdfAttachment } from "../../../src/server/payments/invoice-attachment";
import { context } from "../../fixtures/asset-rows";
import {
  INVOICE_KEY,
  INVOICE_NUMBER,
  invoiceDb,
  invoicePayment,
  failure,
} from "../../fixtures/invoice-snapshot";

// The `invoice_pdf` attachment of the `send_email` step, against a database whose `documents` bucket is a map.

const PAYMENT = { payment_id: "5c1e0a00-0000-4000-8000-000000000002" };
const decoded = (content: string): Uint8Array =>
  Uint8Array.from(atob(content), (c) => c.charCodeAt(0));
describe("invoicePdfAttachment", () => {
  it("is the entry of the registry", () => {
    expect(attachmentResolvers.invoice_pdf).toBe(invoicePdfAttachment);
  });

  it("reads the stored object when the key is set, without rendering", async () => {
    const { db, objects } = invoiceDb(invoicePayment(INVOICE_KEY));
    objects.set(INVOICE_KEY, new TextEncoder().encode("%PDF-stored"));
    const attachment = await invoicePdfAttachment(context(db, "send_email"), PAYMENT);
    expect(attachment.filename).toBe(`${INVOICE_NUMBER}.pdf`);
    expect(new TextDecoder().decode(decoded(attachment.content))).toBe("%PDF-stored");
    expect(db.calls.map((call) => call.name)).toEqual(["payments", "documents.download"]);
  });

  it("renders, stores and attaches when the invoice_pdf job has not run yet", async () => {
    const { db, objects, rows } = invoiceDb(invoicePayment(null));
    const attachment = await invoicePdfAttachment(context(db, "send_email"), PAYMENT);
    expect([...objects.keys()]).toEqual([INVOICE_KEY]);
    expect(rows[0]?.invoice_file_key).toBe(INVOICE_KEY);
    expect(new TextDecoder().decode(decoded(attachment.content).slice(0, 5))).toBe("%PDF-");
    expect(db.calls.filter((call) => call.name === "set_invoice_key")).toHaveLength(1);
    expect(decoded(attachment.content)).toEqual(objects.get(INVOICE_KEY));
  });

  it("rethrows a Storage error so the step retries, and says payment_missing without retrying", async () => {
    const down = new Error("storage down");
    const broken = await failure(
      invoicePdfAttachment(
        context(invoiceDb(invoicePayment(INVOICE_KEY), { download: down }).db, "send_email"),
        PAYMENT,
      ),
    );
    expect(broken).toBe(down);
    expect(broken).not.toBeInstanceOf(NonRetryableError);
    const noPayment = await failure(
      invoicePdfAttachment(context(invoiceDb(null).db, "send_email"), PAYMENT),
    );
    const noId = await failure(
      invoicePdfAttachment(context(invoiceDb(invoicePayment(null)).db, "send_email"), {}),
    );
    expect(
      [noPayment, noId].map((error) => error instanceof NonRetryableError && error.message),
    ).toEqual(["payment_missing", "payment_missing"]);
  });
});
