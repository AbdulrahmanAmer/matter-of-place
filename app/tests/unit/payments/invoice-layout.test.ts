import { afterEach, describe, expect, it, vi } from "vitest";
import { requiredInvoiceFields } from "../../../src/domain/payments";
import {
  formatInvoiceAmount,
  layoutInvoice,
  newInvoiceDocument,
  PAGE,
  sanitizeWinAnsi,
  type InvoiceSnapshot,
  type TextRun,
} from "../../../src/server/payments/invoice-layout";
import { invoiceSnapshot } from "../../fixtures/invoice-snapshot";

// GP-06: every legal field is a run of the page, the layout stays inside the margins, and a name outside WinAnsi
// still draws. The runs are the layout; no PDF reader is needed.

const lines = (runs: readonly TextRun[]): string[] => runs.map((run) => run.text);

/** What each required field reads as on the page, for the snapshot of the fixture. */
const shownAs = {
  entity: "Example Media LLC",
  address: "100 Example Street, New York, NY 10001",
  invoice_number: "MOP-2026-0007",
  issue_date: "Issued October 7, 2026",
  due_date: "Due October 21, 2026",
  description: "The Feature. One property, one editorial feature.",
  amount: "USD 695.00",
  currency: "USD 695.00",
  tax_line: "No sales tax is charged on this invoice.",
  instructions: "Account 000 at Example Bank.",
  late_terms: "Overdue amounts may be subject to a late charge.",
} as const satisfies Record<(typeof requiredInvoiceFields)[number], string>;

function without(field: string): InvoiceSnapshot {
  const copy = structuredClone(invoiceSnapshot());
  Reflect.deleteProperty(copy, field);
  return copy;
}

function insideMargins(run: TextRun): boolean {
  return (
    run.x >= PAGE.margin &&
    run.x + run.width <= PAGE.width - PAGE.margin + 0.001 &&
    run.y >= PAGE.margin &&
    run.y + run.size <= PAGE.height - PAGE.margin
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("layoutInvoice", () => {
  it.each(requiredInvoiceFields)("draws %s and refuses a snapshot that lacks it", async (field) => {
    expect(lines(await layoutInvoice(invoiceSnapshot()))).toContain(shownAs[field]);
    await expect(layoutInvoice(without(field))).rejects.toThrow(`${field}_missing`);
  });

  it("draws the number, every listed method with instructions, the preferred one first", async () => {
    const text = lines(await layoutInvoice(invoiceSnapshot()));
    expect(text).toEqual(
      expect.arrayContaining([
        "Preferred method: Bank transfer",
        "Bank transfer",
        "Wire transfer",
        "Wire to the account above.",
      ]),
    );
    expect(text).not.toContain("Card by phone");
  });

  it("puts the tax line above the total and the late terms under the payment terms", async () => {
    const text = lines(await layoutInvoice(invoiceSnapshot()));
    const at = (value: string) => text.indexOf(value);
    expect(at(shownAs.tax_line)).toBeLessThan(at("Total"));
    expect(at("Payment terms")).toBeLessThan(at(shownAs.late_terms));
    expect(at("Payable within 14 days of the invoice date.")).toBeLessThan(at(shownAs.late_terms));
  });

  it("names the billing address for questions, from the snapshot", async () => {
    const text = lines(await layoutInvoice(invoiceSnapshot()));
    expect(text).toContain("Questions about this invoice: billing@matterofplace.com");
    expect(text).toContain("Editorial acceptance precedes this invoice.");
  });

  it("sets the small wordmark and the display word on one baseline, labels light, only two inks", async () => {
    const runs = await layoutInvoice(invoiceSnapshot());
    const run = (text: string): TextRun => {
      const found = runs.find((entry) => entry.text === text);
      if (found === undefined) throw new Error(`no run ${text}`);
      return found;
    };
    expect(run("Matter of Place").y).toBeCloseTo(run("Invoice").y, 5);
    expect(run("Matter of Place").size).toBeLessThan(run("Invoice").size);
    const labels = [
      "From",
      "Bill to",
      "Property",
      "Description",
      "Amount",
      "Payment terms",
      "How to pay",
    ];
    expect(labels.map((text) => run(text).font)).toEqual(labels.map(() => "sans"));
    expect(new Set(runs.map((entry) => entry.color))).toEqual(
      new Set(["foreground", "mutedForeground"]),
    );
  });

  it("keeps every run inside the page margins, long text wrapped", async () => {
    const long = "Wire to the account named here, quoting the invoice number. ".repeat(3).trim();
    const runs = await layoutInvoice(
      invoiceSnapshot({
        description: long,
        terms: long,
        instructions: [
          { id: "wire", label: "Wire transfer", instructions: `${long}\n${"x".repeat(150)}` },
        ],
        preferred_method: "wire",
        bill_to: {
          name: "A".repeat(120),
          email: `${"b".repeat(80)}@example.invalid`,
          brokerage: null,
          property: long,
        },
      }),
    );
    expect(runs.filter((run) => !insideMargins(run)).map((run) => run.text)).toEqual([]);
    expect(runs.filter((run) => run.text.startsWith("Wire to the account")).length).toBeGreaterThan(
      2,
    );
  });

  it("holds no brokerage line in the Bill to runs of an owner's invoice", async () => {
    const billTo = async (brokerage: string | null): Promise<string[]> => {
      const runs = await layoutInvoice(
        invoiceSnapshot({ bill_to: { ...invoiceSnapshot().bill_to, brokerage } }),
      );
      const column = runs.find((run) => run.text === "Bill to")?.x;
      return lines(runs.filter((run) => run.x === column));
    };
    expect(await billTo("Stone and Partners")).toEqual([
      "Bill to",
      "Avery Stone",
      "Stone and Partners",
      "avery@example.invalid",
    ]);
    expect(await billTo(null)).toEqual(["Bill to", "Avery Stone", "avery@example.invalid"]);
  });

  it("reads a name outside WinAnsi as the standard fonts can draw it and logs the count", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const runs = await layoutInvoice(
      invoiceSnapshot({ bill_to: { ...invoiceSnapshot().bill_to, name: "Zoë Łukasz 王" } }),
    );
    expect(lines(runs)).toContain("Zoë Lukasz ?");
    expect(log).toHaveBeenCalledWith(
      JSON.stringify({ level: "info", event: "invoice_glyph_replaced", count: 2 }),
    );
  });

  it("throws invoice_overflow when the text does not fit one page", async () => {
    const methods = Array.from({ length: 10 }, (_, index) => ({
      id: `method_${String(index)}`,
      label: `Method ${String(index)}`,
      instructions: "Pay to the account named in this line. ".repeat(50),
    }));
    await expect(
      layoutInvoice(invoiceSnapshot({ instructions: methods, preferred_method: "method_0" })),
    ).rejects.toThrow("invoice_overflow");
  });
});

describe("sanitizeWinAnsi", () => {
  it("keeps what WinAnsi draws, folds a letter to its base, and replaces the rest", () => {
    expect(sanitizeWinAnsi("Zoë Łukasz 王 – “ok” ñ")).toEqual({
      text: "Zoë Lukasz ? – “ok” ñ",
      replaced: 2,
    });
    expect(sanitizeWinAnsi("é Ă")).toEqual({ text: "é A", replaced: 1 });
  });

  it("accepts exactly the characters pdf-lib's Helvetica and Times can encode", async () => {
    const { fonts } = await newInvoiceDocument();
    const encoded = new Set(fonts.sans.getCharacterSet());
    for (const code of [...Array(0x2200).keys()].filter((point) => point >= 0x20)) {
      const char = String.fromCodePoint(code);
      const kept = sanitizeWinAnsi(char).text === char;
      if (kept !== encoded.has(code)) throw new Error(`U+${code.toString(16)} disagrees`);
    }
    expect([...encoded].every((code) => fonts.serif.getCharacterSet().includes(code))).toBe(true);
    expect(encoded.size).toBe(218);
  });
});

describe("formatInvoiceAmount", () => {
  it("groups thousands and always shows cents", () => {
    expect(formatInvoiceAmount("USD", 1995)).toBe("USD 1,995.00");
    expect(formatInvoiceAmount("USD", 695.5)).toBe("USD 695.50");
  });
});
