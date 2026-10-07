import type { Tables } from "../../src/db";
import type { InvoiceSnapshot } from "../../src/server/payments/invoice-layout";
import { paymentRow } from "../unit/automation/fixtures/entity-rows";
import { fakeDb, type FakeDb, type FakeDbOptions } from "./fake-db";

// A complete frozen snapshot (as `issue_invoice` stores it) and a database whose `documents` bucket is a map.

export const INVOICE_NUMBER = "MOP-2026-0007";
export const INVOICE_KEY = `2026/${INVOICE_NUMBER}.pdf`;

export function invoiceSnapshot(overrides: Partial<InvoiceSnapshot> = {}): InvoiceSnapshot {
  return {
    invoice_number: INVOICE_NUMBER,
    issue_date: "2026-10-07",
    due_date: "2026-10-21",
    entity: "Example Media LLC",
    address: "100 Example Street, New York, NY 10001",
    contact: { email: "hello@example.invalid", phone: "+1 212 555 0100" },
    description: "The Feature. One property, one editorial feature.",
    amount: 695,
    currency: "USD",
    tax_line: "No sales tax is charged on this invoice.",
    instructions: [
      { id: "bank_transfer", label: "Bank transfer", instructions: "Account 000 at Example Bank." },
      { id: "wire", label: "Wire transfer", instructions: "Wire to the account above." },
      { id: "card_by_phone", label: "Card by phone", instructions: "" },
    ],
    preferred_method: "bank_transfer",
    terms: "Payable within 14 days of the invoice date.",
    late_terms: "Overdue amounts may be subject to a late charge.",
    billing_email: "billing@matterofplace.com",
    bill_to: {
      name: "Avery Stone",
      email: "avery@example.invalid",
      brokerage: "Stone and Partners",
      property: "12 Elm Street, Brooklyn, NY 11201",
    },
    ...overrides,
  };
}

export interface InvoiceDb {
  db: FakeDb;
  /** The rows of `payments` the database answers; `set_invoice_key` writes the first one's key. */
  rows: Tables<"payments">[];
  /** The `documents` bucket. */
  objects: Map<string, Uint8Array>;
}

interface Failures {
  upload?: unknown;
  download?: unknown;
}

/** One payment row (or none) over a fake database whose `documents` bucket answers upload and download. */
export function invoiceDb(
  row: Tables<"payments"> | null,
  failures: Failures = {},
  otherTables: Omit<NonNullable<FakeDbOptions["tables"]>, "payments"> = {},
): InvoiceDb {
  const rows = row === null ? [] : [row];
  const objects = new Map<string, Uint8Array>();
  const db = fakeDb({
    tables: { ...otherTables, payments: rows },
    rpc: {
      set_invoice_key: ({ p_key }) => {
        const first = rows[0];
        if (first === undefined) return new Error("not_found");
        first.invoice_file_key ??= p_key;
        return first.invoice_file_key;
      },
    },
    storage: {
      documents: {
        upload: (path, bytes) => {
          if (failures.upload !== undefined) return { data: null, error: failures.upload };
          if (typeof path === "string" && bytes instanceof Uint8Array) objects.set(path, bytes);
          return { data: { path }, error: null };
        },
        download: (path) => {
          if (failures.download !== undefined) return { data: null, error: failures.download };
          const bytes = typeof path === "string" ? objects.get(path) : undefined;
          return bytes === undefined
            ? { data: null, error: new Error("Object not found") }
            : { data: new Blob([bytes.slice()]), error: null };
        },
      },
    },
  });
  return { db, rows, objects };
}

/** A payment of the fixture invoice: its snapshot frozen, its key as given. */
export function invoicePayment(
  invoiceFileKey: string | null,
  snapshot: InvoiceSnapshot | null = invoiceSnapshot(),
): Tables<"payments"> {
  return paymentRow({
    invoice_number: INVOICE_NUMBER,
    invoice_file_key: invoiceFileKey,
    invoice_snapshot: snapshot,
  });
}

/** What a promise rejects with, or null when it resolves. */
export const failure = (pending: Promise<unknown>): Promise<unknown> =>
  pending.then(
    () => null,
    (error: unknown) => error,
  );
