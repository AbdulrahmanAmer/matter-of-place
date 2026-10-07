import type { z } from "zod";
import { invoiceSettingsSchema } from "../../domain/payments.ts";
import { emptySiteSettings, siteSettingsSchema, type SiteSettings } from "../../domain/settings.ts";
import { fromRpcError } from "../lib/admin-errors.ts";
import type { ActorKind } from "../lib/authz.ts";
import type { Db } from "../lib/db.ts";
import { fromZod } from "../lib/errors.ts";

// `settings.invoice` and the readiness of invoicing (B6 invariant 7): the read of the two settings rows an invoice
// needs, the write of `settings.invoice` below a route, and the list of what is still missing.

export type InvoiceSettings = z.output<typeof invoiceSettingsSchema>;

export interface InvoiceInputs {
  site: SiteSettings;
  /** Null when the stored value does not parse. */
  invoice: InvoiceSettings | null;
}

/** Who writes: a person or agent with an id, or the system (null id) that a script stands for. */
export interface InvoiceSettingsActor {
  id: string | null;
  kind: ActorKind;
  requestId: string;
  note: string;
}

/** `settings.site` and `settings.invoice` straight from the table, never through the public-state memo. */
export async function readInvoiceInputs(db: Db): Promise<InvoiceInputs> {
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

/**
 * What an invoice still lacks, as dotted setting names in the order of invariant 7; empty when it can be issued.
 * A blank value is missing because the schema trims, so a line of spaces has already become empty.
 */
export function invoiceReadiness(site: SiteSettings, invoice: InvoiceSettings | null): string[] {
  const missing: string[] = [];
  if (site.legal.entity === null) missing.push("legal.entity");
  if (site.legal.address === null) missing.push("legal.address");
  if (site.contact.email === null) missing.push("contact.email");
  if (invoice === null) return [...missing, "invoice"];
  if (!invoice.payment_methods.some((method) => method.instructions !== "")) {
    missing.push("payment_methods.instructions");
  }
  for (const key of ["terms", "late_terms", "tax_line"] as const) {
    if (invoice[key] === "") missing.push(key);
  }
  return missing;
}

/** The generated `Args` type lists every uuid as a string, while SQL takes a null actor as the system. */
function actorArg(id: string | null): string {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- null is the system actor of write_audit; the generated Args type cannot say so
  return id as string;
}

/**
 * Validates `input` against `invoiceSettingsSchema` and writes it through `settings_put_invoice`, which audits the
 * change in the same transaction. Throws a 422 `validation` with the Zod issues, or the RPC's own error code.
 * No authorization here: the caller holds `settings.invoice_put` (a route) or is a script on the one database.
 */
export async function applyInvoiceSettings(
  db: Db,
  input: unknown,
  actor: InvoiceSettingsActor,
): Promise<InvoiceSettings> {
  const parsed = invoiceSettingsSchema.safeParse(input);
  if (!parsed.success) throw fromZod(parsed.error);
  const { error } = await db.rpc("settings_put_invoice", {
    p_value: parsed.data,
    p_actor: actorArg(actor.id),
    p_actor_kind: actor.kind,
    p_request_id: actor.requestId,
    p_note: actor.note,
  });
  if (error !== null) throw fromRpcError(error);
  return parsed.data;
}
