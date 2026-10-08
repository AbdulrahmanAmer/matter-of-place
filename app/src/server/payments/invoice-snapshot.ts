import type { ZodIssue } from "zod";
import {
  requiredInvoiceFields,
  sqlAssignedFields,
  type IssueInvoiceInput,
} from "../../domain/payments.ts";
import type { SubmissionRow } from "../../domain/rows.ts";
import type { Db } from "../lib/db.ts";
import { AppError } from "../lib/errors.ts";
import { isBlank } from "./invoice-layout.ts";
import { invoiceReadiness, readInvoiceInputs } from "./invoice-settings.ts";
import { offeringFor, priceFor } from "./pricing.ts";

// The invoice as it is frozen at issue (invariant 5, GP-06). It reads `settings.site` and `settings.invoice` straight
// from the table, never through the public-state memo, so an invoice never carries a cached legal identity.

/** The submission fields of the bill-to block. */
export type BillTo = Pick<
  SubmissionRow,
  "submitter_name" | "submitter_email" | "brokerage" | "address" | "city" | "state" | "zip"
>;

/** Invariant 7: 409 `invoice_not_ready`, one issue per missing setting, so the screen can name each. */
export async function assertInvoiceReady(db: Db): Promise<void> {
  const { site, invoice } = await readInvoiceInputs(db);
  const missing = invoiceReadiness(site, invoice);
  if (missing.length === 0) return;
  const issues: ZodIssue[] = missing.map((field) => ({
    code: "custom",
    path: field.split("."),
    message: "Required before an invoice can be issued.",
  }));
  throw new AppError(
    "invoice_not_ready",
    undefined,
    `Invoice settings are missing: ${missing.join(", ")}.`,
    issues,
  );
}

const incomplete = (field: string) =>
  new AppError("server", undefined, `snapshot_incomplete:${field}`);

/**
 * Every field of `requiredInvoiceFields` except the number and the two dates, which `issue_invoice` adds in the
 * transaction that assigns the number. Throws `snapshot_incomplete:<field>` when one is blank.
 */
export async function buildInvoiceSnapshot(
  db: Db,
  submission: BillTo,
  product: IssueInvoiceInput["product"],
  preferredMethod: string,
) {
  const { site, invoice } = await readInvoiceInputs(db);
  if (invoice === null) throw incomplete("invoice");
  const offering = offeringFor(product);
  const snapshot = {
    entity: site.legal.entity ?? "",
    address: site.legal.address ?? "",
    contact: { email: site.contact.email ?? "", phone: site.contact.phone },
    description: `${offering.name}. ${offering.line}`,
    amount: priceFor(product),
    currency: "USD",
    tax_line: invoice.tax_line,
    instructions: invoice.payment_methods,
    preferred_method: preferredMethod,
    terms: invoice.terms,
    late_terms: invoice.late_terms,
    billing_email: invoice.billing_email,
    bill_to: {
      name: submission.submitter_name,
      email: submission.submitter_email,
      brokerage: submission.brokerage,
      property: `${submission.address}, ${submission.city}, ${submission.state} ${submission.zip}`,
    },
  };
  const assigned: readonly string[] = sqlAssignedFields;
  const blank = requiredInvoiceFields
    .filter((field) => !assigned.includes(field))
    .find((field) => {
      const value: unknown = Reflect.get(snapshot, field);
      return isBlank(value);
    });
  if (blank !== undefined) throw incomplete(blank);
  return snapshot;
}
