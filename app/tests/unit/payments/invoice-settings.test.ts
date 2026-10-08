import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Json } from "../../../src/db";
import { invoiceSettingsSchema } from "../../../src/domain/payments";
import { siteSettingsSchema } from "../../../src/domain/settings";
import { AppError } from "../../../src/server/lib/errors";
import {
  applyInvoiceSettings,
  invoiceReadiness,
  readInvoiceInputs,
} from "../../../src/server/payments/invoice-settings";
import { fakeDb } from "../../fixtures/fake-db";

function fixture(name: string): unknown {
  const text = readFileSync(new URL(`../../../scripts/fixtures/${name}`, import.meta.url), "utf8");
  return JSON.parse(text);
}

const example = invoiceSettingsSchema.parse(fixture("invoice.example.json"));
const seed = invoiceSettingsSchema.parse(fixture("invoice.seed.json"));
const site = siteSettingsSchema.parse({
  contact: { email: "hello@example.invalid" },
  legal: { entity: "Test Entity LLC", address: "1 Test Street, Test City, CA 90000" },
});
const STAMP = "2026-10-07T09:00:00.000Z";
const actor = {
  id: null,
  kind: "human",
  requestId: "set-invoice:test",
  note: "script: set-invoice",
} as const;

describe("invoice fixtures", () => {
  it("the example is test text that makes invoicing ready and the seed lacks only payment instructions", () => {
    expect(JSON.stringify(example.payment_methods)).toContain("Test only (dev)");
    expect(invoiceReadiness(site, example)).toEqual([]);
    expect(invoiceReadiness(site, seed)).toEqual(["payment_methods.instructions"]);
  });
});

describe("invoiceReadiness", () => {
  it("lists every blank setting by its dotted name, in the order of invariant 7", () => {
    const blank = { ...example, terms: "", late_terms: "", tax_line: "", payment_methods: [] };
    const missing = invoiceReadiness(siteSettingsSchema.parse({}), blank);
    expect(missing).toEqual([
      "legal.entity",
      "legal.address",
      "contact.email",
      "payment_methods.instructions",
      "terms",
      "late_terms",
      "tax_line",
    ]);
  });

  it("is ready with one method that has instructions, however many do not", () => {
    const one = example.payment_methods.map((method, index) =>
      index === 0 ? method : { ...method, instructions: "" },
    );
    expect(invoiceReadiness(site, { ...example, payment_methods: one })).toEqual([]);
  });

  it("names invoice when the stored value does not parse", () => {
    expect(invoiceReadiness(site, null)).toEqual(["invoice"]);
  });
});

describe("readInvoiceInputs", () => {
  it("parses the site and invoice rows and reads an unparseable invoice as null", async () => {
    const rows = (invoice: NonNullable<Json>) => [
      { key: "site", value: site, updated_at: STAMP, updated_by: null },
      { key: "invoice", value: invoice, updated_at: STAMP, updated_by: null },
    ];
    const good = await readInvoiceInputs(fakeDb({ tables: { settings: rows(example) } }));
    const bad = await readInvoiceInputs(fakeDb({ tables: { settings: rows({ prefix: "x" }) } }));
    expect(good).toEqual({ site, invoice: example });
    expect(bad).toEqual({ site, invoice: null });
  });
});

describe("applyInvoiceSettings", () => {
  it("calls settings_put_invoice once with the validated value and the actor", async () => {
    const db = fakeDb({ rpc: { settings_put_invoice: () => undefined } });
    const applied = await applyInvoiceSettings(db, { ...example, terms: "  Net 14.  " }, actor);
    expect(applied.terms).toBe("Net 14.");
    expect(db.calls).toEqual([
      {
        kind: "rpc",
        name: "settings_put_invoice",
        args: [
          {
            p_value: { ...example, terms: "Net 14." },
            p_actor: null,
            p_actor_kind: "human",
            p_request_id: "set-invoice:test",
            p_note: "script: set-invoice",
          },
        ],
      },
    ]);
  });

  it("refuses a value the schema rejects with 422 and its issues, and calls nothing", async () => {
    const db = fakeDb();
    const refusal: unknown = await applyInvoiceSettings(
      db,
      { ...example, prefix: "mop", due_days: 0 },
      actor,
    ).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(AppError);
    const paths =
      refusal instanceof AppError
        ? (refusal.issues ?? []).map((issue) => issue.path.join("."))
        : [];
    expect([refusal instanceof AppError ? refusal.status : 0, paths]).toEqual([
      422,
      ["prefix", "due_days"],
    ]);
    expect(db.calls).toEqual([]);
  });

  it("throws the database's error code when the function raises", async () => {
    const db = fakeDb({ rpc: { settings_put_invoice: () => new Error("forbidden") } });
    const refusal: unknown = await applyInvoiceSettings(db, example, actor).catch(
      (error: unknown) => error,
    );
    expect(refusal instanceof AppError ? refusal.code : refusal).toBe("forbidden");
  });
});
