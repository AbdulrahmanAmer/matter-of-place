import { PDFDocument } from "pdf-lib";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Tables } from "../../../src/db";
import { NonRetryableError } from "../../../src/server/jobs/types";
import { AppError } from "../../../src/server/lib/errors";
import {
  ensureInvoicePdf,
  invoiceSignedUrl,
  renderInvoicePdf,
  storageInvoiceStore,
  type PdfStore,
} from "../../../src/server/payments/invoice-pdf";
import { fakeDb } from "../../fixtures/fake-db";
import {
  INVOICE_KEY,
  invoiceDb,
  invoicePayment,
  invoiceSnapshot,
  failure,
} from "../../fixtures/invoice-snapshot";

// The PDF is made from the frozen snapshot only (B6 invariant 5), stored in the private bucket `documents` at
// `<year>/<invoice_number>.pdf`, and recorded once.

const header = (bytes: Uint8Array): string => new TextDecoder().decode(bytes.slice(0, 5));

/** A store that keeps what it is given and counts the writes. */
function memoryStore(): PdfStore & { objects: Map<string, Uint8Array>; puts: string[] } {
  const objects = new Map<string, Uint8Array>();
  const puts: string[] = [];
  return {
    objects,
    puts,
    put: (path, bytes) => {
      puts.push(path);
      objects.set(path, bytes);
      return Promise.resolve();
    },
    get: (path) => Promise.resolve(objects.get(path) ?? new Uint8Array()),
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("renderInvoicePdf", () => {
  it("makes one US Letter page whose bytes start with %PDF", async () => {
    const bytes = await renderInvoicePdf(invoiceSnapshot());
    const loaded = await PDFDocument.load(bytes);
    expect(header(bytes)).toBe("%PDF-");
    expect(loaded.getPageCount()).toBe(1);
    expect(loaded.getPage(0).getSize()).toEqual({ width: 612, height: 792 });
  });

  it("renders a submitter name outside WinAnsi", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const snapshot = invoiceSnapshot({
      bill_to: { ...invoiceSnapshot().bill_to, name: "Zoë Łukasz 王" },
    });
    expect(header(await renderInvoicePdf(snapshot))).toBe("%PDF-");
  });

  it("gives the same bytes for the same snapshot, whatever the clock says", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-07T10:00:00Z"));
    const first = await renderInvoicePdf(invoiceSnapshot());
    vi.setSystemTime(new Date("2026-12-31T23:59:59Z"));
    const second = await renderInvoicePdf(invoiceSnapshot());
    expect(Buffer.from(second).equals(Buffer.from(first))).toBe(true);
  });
});

describe("ensureInvoicePdf", () => {
  it("renders the stored snapshot, stores it at <year>/<invoice_number>.pdf and records the key once", async () => {
    const { db } = invoiceDb(invoicePayment(null));
    const store = memoryStore();
    const done = await ensureInvoicePdf(db, "5c1e0a00-0000-4000-8000-000000000002", store);
    expect(done).toEqual({ key: INVOICE_KEY, existed: false });
    expect(store.puts).toEqual([INVOICE_KEY]);
    expect(header(store.objects.get(INVOICE_KEY) ?? new Uint8Array())).toBe("%PDF-");
    expect(db.calls.filter((call) => call.name === "set_invoice_key")).toEqual([
      {
        kind: "rpc",
        name: "set_invoice_key",
        args: [{ p_payment_id: "5c1e0a00-0000-4000-8000-000000000002", p_key: INVOICE_KEY }],
      },
    ]);
  });

  it("answers the key that was recorded first when two renders finish together", async () => {
    const { db, rows } = invoiceDb(invoicePayment(null));
    const inner = memoryStore();
    const store: PdfStore = {
      get: (path) => inner.get(path),
      put: async (path, bytes) => {
        await inner.put(path, bytes);
        const [row] = rows;
        if (row !== undefined) row.invoice_file_key = "2026/recorded-first.pdf";
      },
    };
    const done = await ensureInvoicePdf(db, "5c1e0a00-0000-4000-8000-000000000002", store);
    expect(done).toEqual({ key: "2026/recorded-first.pdf", existed: false });
  });

  it("renders from the stored snapshot, not from settings changed after the issue", async () => {
    const before = await renderInvoicePdf(invoiceSnapshot());
    const settings: Tables<"settings">[] = [
      {
        key: "site",
        value: { legal: { entity: "Another Entity Inc.", address: "1 Other Road" } },
        updated_at: "2026-10-08T00:00:00.000Z",
        updated_by: null,
      },
    ];
    const { db } = invoiceDb(invoicePayment(null), {}, { settings });
    const store = memoryStore();
    await ensureInvoicePdf(db, "5c1e0a00-0000-4000-8000-000000000002", store);
    const after = store.objects.get(INVOICE_KEY) ?? new Uint8Array();
    expect(Buffer.from(after).equals(Buffer.from(before))).toBe(true);
  });

  it("leaves a payment whose key is set alone", async () => {
    const { db } = invoiceDb(invoicePayment(INVOICE_KEY));
    const store = memoryStore();
    const done = await ensureInvoicePdf(db, "5c1e0a00-0000-4000-8000-000000000002", store);
    expect(done).toEqual({ key: INVOICE_KEY, existed: true });
    expect(store.puts).toEqual([]);
    expect(db.calls.filter((call) => call.kind === "rpc")).toEqual([]);
  });

  it("says payment_missing, snapshot_missing and snapshot_invalid without retrying", async () => {
    const asked = async (row: Tables<"payments"> | null): Promise<unknown> =>
      failure(
        ensureInvoicePdf(invoiceDb(row).db, "5c1e0a00-0000-4000-8000-000000000002", memoryStore()),
      );
    const invalid = invoicePayment(null);
    invalid.invoice_snapshot = { entity: "Only an entity" };
    const errors = [
      await asked(null),
      await asked(invoicePayment(null, null)),
      await asked(invalid),
    ];
    expect(errors.map((error) => error instanceof NonRetryableError && error.message)).toEqual([
      "payment_missing",
      "snapshot_missing",
      "snapshot_invalid",
    ]);
  });
});

describe("storageInvoiceStore", () => {
  it("writes to the bucket documents without overwriting, as application/pdf", async () => {
    const { db, objects } = invoiceDb(null);
    const bytes = new Uint8Array([37, 80, 68, 70]);
    await storageInvoiceStore(db).put(INVOICE_KEY, bytes);
    expect(db.calls).toEqual([
      {
        kind: "storage",
        name: "documents.upload",
        args: [INVOICE_KEY, bytes, { contentType: "application/pdf", upsert: false }],
      },
    ]);
    expect(objects.get(INVOICE_KEY)).toBe(bytes);
  });

  it("counts a 409 already exists answer as stored and throws any other error as it came", async () => {
    const exists = { message: "The resource already exists", status: 409, statusCode: "409" };
    await expect(
      storageInvoiceStore(invoiceDb(null, { upload: exists }).db).put(
        INVOICE_KEY,
        new Uint8Array(),
      ),
    ).resolves.toBeUndefined();
    const down = new Error("fetch failed");
    const thrown = await failure(
      storageInvoiceStore(invoiceDb(null, { upload: down }).db).put(INVOICE_KEY, new Uint8Array()),
    );
    expect(thrown).toBe(down);
  });

  it("reads the object back as bytes and throws a Storage error as it came", async () => {
    const { db, objects } = invoiceDb(null);
    objects.set(INVOICE_KEY, new Uint8Array([1, 2, 3]));
    expect(await storageInvoiceStore(db).get(INVOICE_KEY)).toEqual(new Uint8Array([1, 2, 3]));
    const missing = await failure(storageInvoiceStore(db).get("2026/none.pdf"));
    expect(missing).toEqual(new Error("Object not found"));
  });
});

describe("invoiceSignedUrl", () => {
  it("asks the bucket documents for a link of 60 seconds", async () => {
    const db = fakeDb({
      storage: {
        documents: { createSignedUrl: () => ({ data: { signedUrl: "https://s/x" }, error: null }) },
      },
    });
    expect(await invoiceSignedUrl(db, INVOICE_KEY)).toBe("https://s/x");
    expect(db.calls).toEqual([
      { kind: "storage", name: "documents.createSignedUrl", args: [INVOICE_KEY, 60] },
    ]);
  });

  it("answers 503 storage_unavailable when Storage does not answer", async () => {
    const db = fakeDb({
      storage: { documents: { createSignedUrl: () => ({ data: null, error: new Error("down") }) } },
    });
    const error = await failure(invoiceSignedUrl(db, INVOICE_KEY));
    expect(error instanceof AppError && [error.status, error.code]).toEqual([
      503,
      "storage_unavailable",
    ]);
  });
});
