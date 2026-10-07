import type { ZodIssue } from "zod";
import {
  invoiceSettingsSchema,
  requiredInvoiceFields,
  sqlAssignedFields,
  type IssueInvoiceInput,
} from "../../domain/payments.ts";
import type { SubmissionRow } from "../../domain/rows.ts";
import { emptySiteSettings, siteSettingsSchema, type SiteSettings } from "../../domain/settings.ts";
import { fromRpcError } from "../lib/admin-errors.ts";
import type { Db } from "../lib/db.ts";
import { AppError } from "../lib/errors.ts";
import { offeringFor, priceFor } from "./pricing.ts";

// The invoice as it is frozen at issue (invariant 5, GP-06). It reads `settings.site` and `settings.invoice` straight
// from the table, never through the public-state memo, so an invoice never carries a cached legal identity.

type InvoiceSettings = ReturnType<typeof invoiceSettingsSchema.parse>;

/** The submission fields of the bill-to block. */
export type BillTo = Pick<
  SubmissionRow,
  "submitter_name" | "submitter_email" | "brokerage" | "address" | "city" | "state" | "zip"
>;

interface InvoiceInputs {
  site: SiteSettings;
  /** Null when the stored value does not parse. */
  invoice: InvoiceSettings | null;
}

async function readInvoiceInputs(db: Db): Promise<InvoiceInputs> {
  const { data, error } = await db
    .from("settings")
    .select("key, value")
    .in("key", ["site", "invoice"]);
  if (error !== null) throw fromRpcError(error);
  const valueOf = (key: string): unknown => data.find((row) => row.key === key)?.value;
  return {
    site: siteSettingsSchema.safeParse(valueOf("site")).data ?? emptySiteSettings,
    invoice: invoiceSettingsSchema.safeParse(valueOf("invoice")).data ?? null,
  };
}

// STUB(B6 step 4): invoiceReadiness of invoice-settings.ts replaces this list
function missingForInvoice({ site, invoice }: InvoiceInputs): string[] {
  const missing: string[] = [];
  if (site.legal.entity === null) missing.push("legal.entity");
  if (site.legal.address === null) missing.push("legal.address");
  if (site.contact.email === null) missing.push("contact.email");
  if (invoice === null) return [...missing, "invoice"];
  if (!invoice.payment_methods.some((method) => method.instructions !== "")) {
    missing.push("payment_methods");
  }
  for (const key of ["terms", "late_terms", "tax_line"] as const) {
    if (invoice[key] === "") missing.push(key);
  }
  return missing;
}

/** Invariant 7: 409 `invoice_not_ready`, one issue per missing setting, so the screen can name each. */
export async function assertInvoiceReady(db: Db): Promise<void> {
  const missing = missingForInvoice(await readInvoiceInputs(db));
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

function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (typeof value === "number") return !(value > 0);
  return Array.isArray(value) && value.length === 0;
}

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
