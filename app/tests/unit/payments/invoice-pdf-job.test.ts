import { describe, expect, it } from "vitest";
import { getSystemJob } from "../../../src/server/jobs/system";
import { invoicePdf } from "../../../src/server/jobs/system/invoice-pdf";
import { NonRetryableError } from "../../../src/server/jobs/types";
import { context } from "../../fixtures/asset-rows";
import {
  INVOICE_KEY,
  invoiceDb,
  invoicePayment,
  type InvoiceDb,
  failure,
} from "../../fixtures/invoice-snapshot";

// The `invoice_pdf` job: what it stores, what it skips and which failures are final.

const PAYMENT = { payment_id: "5c1e0a00-0000-4000-8000-000000000002" };

const run = (world: InvoiceDb) => invoicePdf.run(context(world.db, "invoice_pdf"), {}, PAYMENT);
describe("the invoice_pdf job", () => {
  it("is a system job with 12 attempts", () => {
    expect(getSystemJob("invoice_pdf")).toBe(invoicePdf);
    expect(invoicePdf.maxAttempts).toBe(12);
  });

  it("stores the PDF and answers its key", async () => {
    const world = invoiceDb(invoicePayment(null));
    expect(await run(world)).toEqual({ status: "done", result: { key: INVOICE_KEY } });
    expect([...world.objects.keys()]).toEqual([INVOICE_KEY]);
  });

  it("invoice_pdf runs twice without a second outside effect", async () => {
    const world = invoiceDb(invoicePayment(null));
    await run(world);
    expect(await run(world)).toEqual({
      status: "done",
      result: { key: INVOICE_KEY, skipped: "exists" },
    });
    expect(world.db.calls.filter((call) => call.name === "documents.upload")).toHaveLength(1);
  });

  it("answers payment_missing and snapshot_missing as final failures", async () => {
    const errors = [
      await failure(run(invoiceDb(null))),
      await failure(run(invoiceDb(invoicePayment(null, null)))),
    ];
    expect(errors.map((error) => error instanceof NonRetryableError && error.message)).toEqual([
      "payment_missing",
      "snapshot_missing",
    ]);
  });

  it("rethrows a Storage failure so the job is retried", async () => {
    const down = new Error("fetch failed");
    const thrown = await failure(run(invoiceDb(invoicePayment(null), { upload: down })));
    expect(thrown).toBe(down);
    expect(thrown).not.toBeInstanceOf(NonRetryableError);
  });
});
