import type { PDFDocument, PDFFont } from "pdf-lib";
import { z } from "zod";
import { paymentMethodSchema, requiredInvoiceFields } from "../../domain/payments.ts";
import type { themeRgb } from "../../templates/theme.gen.ts";
import { AppError } from "../lib/errors.ts";
import { logLine } from "../lib/log.ts";

// Where every line of an invoice goes on its one US Letter page, from the frozen `payments.invoice_snapshot` only
// (B6 invariant 5). The layout is a list of positioned text runs, so the legal fields (GP-06) can be tested without
// a PDF reader; `invoice-pdf.ts` draws the runs. Widths come from pdf-lib's standard-font metrics.

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** The snapshot `buildInvoiceSnapshot` writes, with the number and the two dates `issue_invoice` adds. */
export const invoiceSnapshotSchema = z.object({
  invoice_number: z.string(),
  issue_date: isoDate,
  due_date: isoDate,
  entity: z.string(),
  address: z.string(),
  contact: z.object({ email: z.string(), phone: z.string().nullable() }),
  description: z.string(),
  amount: z.number(),
  currency: z.string(),
  tax_line: z.string(),
  instructions: z.array(paymentMethodSchema),
  preferred_method: z.string(),
  terms: z.string(),
  late_terms: z.string(),
  billing_email: z.string(),
  bill_to: z.object({
    name: z.string(),
    email: z.string(),
    brokerage: z.string().nullable(),
    property: z.string(),
  }),
});
export type InvoiceSnapshot = z.infer<typeof invoiceSnapshotSchema>;

/** Times Roman for the headings, Helvetica for the text (the brand fonts are a follow-up). */
type InvoiceFont = "serif" | "sans" | "sansBold";
type InvoiceColor = keyof typeof themeRgb;

export const PAGE = { width: 612, height: 792, margin: 54 } as const;

/** One line of text: `y` is its baseline from the bottom of the page, `width` its measured length. */
export interface TextRun {
  text: string;
  x: number;
  y: number;
  width: number;
  size: number;
  font: InvoiceFont;
  color: InvoiceColor;
}

interface Style {
  size: number;
  font: InvoiceFont;
  color: InvoiceColor;
}

const LEADING = 1.4;
const CONTENT_WIDTH = PAGE.width - 2 * PAGE.margin;
const COLUMN_WIDTH = 240;
const RIGHT_COLUMN_X = PAGE.margin + CONTENT_WIDTH - COLUMN_WIDTH;
const AMOUNT_WIDTH = 110;

const heading: Style = { size: 24, font: "serif", color: "foreground" };
const label: Style = { size: 8.5, font: "sansBold", color: "mutedForeground" };
const body: Style = { size: 10, font: "sans", color: "foreground" };
const strong: Style = { size: 10, font: "sansBold", color: "foreground" };
const total: Style = { size: 13, font: "sansBold", color: "foreground" };
const note: Style = { size: 9, font: "sans", color: "mutedForeground" };

// The characters WinAnsi can draw: printable ASCII, Latin-1 from U+00A0, and these 27 (what pdf-lib's character set
// lists for Helvetica and Times Roman, checked by invoice-layout.test.ts).
const WIN_ANSI_BEYOND_LATIN1 = "ŒœŠšŸŽžƒˆ˜–\u2014‘’‚“”„†‡•…‰‹›€™";
// Letters with no decomposition that still have an ASCII base.
const FOLDS = new Map([
  ["Ł", "L"],
  ["ł", "l"],
  ["Đ", "D"],
  ["đ", "d"],
  ["Ħ", "H"],
  ["ħ", "h"],
  ["ı", "i"],
]);

function drawable(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return (
    (code >= 0x20 && code <= 0x7e) ||
    (code >= 0xa0 && code <= 0xff) ||
    WIN_ANSI_BEYOND_LATIN1.includes(char)
  );
}

/**
 * The standard fonts draw WinAnsi only. A letter with a WinAnsi form stays (`ë`), another folds to its ASCII base
 * (`Ł` to `L`, `ñ` stays), anything else becomes `?`; `replaced` counts the characters that changed.
 */
export function sanitizeWinAnsi(text: string): { text: string; replaced: number } {
  let replaced = 0;
  const chars = Array.from(text.normalize("NFC"), (char) => {
    if (drawable(char)) return char;
    replaced += 1;
    const base = FOLDS.get(char) ?? char.normalize("NFD").replace(/\p{M}/gu, "");
    return Array.from(base).length === 1 && drawable(base) ? base : "?";
  });
  return { text: chars.join(""), replaced };
}

export interface InvoiceDocument {
  doc: PDFDocument;
  fonts: Record<InvoiceFont, PDFFont>;
}

/**
 * A new document with the three standard fonts embedded. pdf-lib is loaded here, when a PDF is made, so the Worker
 * that only signs a link for it never loads the library.
 */
export async function newInvoiceDocument(): Promise<InvoiceDocument> {
  const { PDFDocument: Document, StandardFonts } = await import("pdf-lib");
  const doc = await Document.create({ updateMetadata: false });
  return {
    doc,
    fonts: {
      serif: doc.embedStandardFont(StandardFonts.TimesRoman),
      sans: doc.embedStandardFont(StandardFonts.Helvetica),
      sansBold: doc.embedStandardFont(StandardFonts.HelveticaBold),
    },
  };
}

let measuring: Promise<InvoiceDocument> | undefined;

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** `2026-10-07` as `October 7, 2026`. The snapshot holds the UTC date `issue_invoice` took, so no clock is read. */
function longDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  const name = MONTHS[Number(month) - 1];
  return name === undefined ? iso : `${name} ${String(Number(day))}, ${String(year)}`;
}

/** `USD 1,995.00`. */
export function formatInvoiceAmount(currency: string, amount: number): string {
  const grouped = amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${currency} ${grouped}`;
}

/** A value an invoice cannot show: nothing, blank text, a number that is not above zero, an empty list. */
export function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (typeof value === "number") return !(value > 0);
  return Array.isArray(value) && value.length === 0;
}

/**
 * The positioned runs of one invoice, top to bottom. Throws `<field>_missing` for a blank field of
 * `requiredInvoiceFields`, and `invoice_overflow` when the text does not fit one page.
 */
export async function layoutInvoice(snapshot: InvoiceSnapshot): Promise<TextRun[]> {
  const missing = requiredInvoiceFields.find((field) => isBlank(Reflect.get(snapshot, field)));
  if (missing !== undefined) throw new AppError("server", undefined, `${missing}_missing`);
  measuring ??= newInvoiceDocument();
  const { fonts } = await measuring;
  const runs: TextRun[] = [];
  let replaced = 0;

  const clean = (text: string): string => {
    const result = sanitizeWinAnsi(text.replace(/\t/g, " "));
    replaced += result.replaced;
    return result.text;
  };
  const widthOf = (text: string, style: Style): number =>
    fonts[style.font].widthOfTextAtSize(text, style.size);

  /** The lines of a text inside `maxWidth`: each paragraph wraps at spaces, a word longer than a line breaks. */
  function wrap(text: string, style: Style, maxWidth: number): string[] {
    const lines: string[] = [];
    for (const paragraph of clean(text).split(/\r\n|\r|\n/)) {
      let line = "";
      for (const word of paragraph.split(" ").filter((part) => part !== "")) {
        for (const piece of breakWord(word, style, maxWidth)) {
          const joined = line === "" ? piece : `${line} ${piece}`;
          if (line !== "" && widthOf(joined, style) > maxWidth) {
            lines.push(line);
            line = piece;
          } else line = joined;
        }
      }
      lines.push(line);
    }
    return lines;
  }

  function breakWord(word: string, style: Style, maxWidth: number): string[] {
    const pieces: string[] = [];
    let piece = "";
    for (const char of word) {
      if (piece !== "" && widthOf(piece + char, style) > maxWidth) {
        pieces.push(piece);
        piece = char;
      } else piece += char;
    }
    return [...pieces, piece];
  }

  /** Draws `text` at `x` (or ending at `right`), one line below `top`; answers the new `top`. */
  function put(text: string, style: Style, top: number, at: { x: number } | { right: number }) {
    const next = top + style.size * LEADING;
    if (next > PAGE.height - PAGE.margin)
      throw new AppError("server", undefined, "invoice_overflow");
    const width = widthOf(text, style);
    const x = "x" in at ? at.x : at.right - width;
    runs.push({
      text,
      x,
      y: PAGE.height - next,
      width,
      size: style.size,
      font: style.font,
      color: style.color,
    });
    return next;
  }

  /** The wrapped lines of `text` in a column starting at `x`; answers the new `top`. */
  function block(text: string, style: Style, top: number, x: number, maxWidth: number): number {
    return wrap(text, style, maxWidth).reduce(
      (at, line) => (line === "" ? at + style.size * LEADING : put(line, style, at, { x })),
      top,
    );
  }

  // Header: the wordmark left, the invoice facts right.
  let top: number = PAGE.margin;
  const wordmark = put("Matter of Place", heading, top, { x: PAGE.margin });
  const sub = put("A product of Omnikom.", note, wordmark, { x: PAGE.margin });
  let facts = put("Invoice", heading, top, { right: PAGE.width - PAGE.margin });
  facts = put(clean(snapshot.invoice_number), strong, facts, { right: PAGE.width - PAGE.margin });
  facts = put(`Issued ${longDate(snapshot.issue_date)}`, body, facts, {
    right: PAGE.width - PAGE.margin,
  });
  facts = put(`Due ${longDate(snapshot.due_date)}`, body, facts, {
    right: PAGE.width - PAGE.margin,
  });
  top = Math.max(sub, facts) + 22;

  // From and Bill to, side by side.
  const fromStart = put("From", label, top, { x: PAGE.margin });
  const billStart = put("Bill to", label, top, { x: RIGHT_COLUMN_X });
  let from = block(snapshot.entity, strong, fromStart, PAGE.margin, COLUMN_WIDTH);
  from = block(snapshot.address, body, from, PAGE.margin, COLUMN_WIDTH);
  from = block(snapshot.contact.email, body, from, PAGE.margin, COLUMN_WIDTH);
  if (snapshot.contact.phone !== null) {
    from = block(snapshot.contact.phone, body, from, PAGE.margin, COLUMN_WIDTH);
  }
  let bill = block(snapshot.bill_to.name, strong, billStart, RIGHT_COLUMN_X, COLUMN_WIDTH);
  if (snapshot.bill_to.brokerage !== null && snapshot.bill_to.brokerage.trim() !== "") {
    bill = block(snapshot.bill_to.brokerage, body, bill, RIGHT_COLUMN_X, COLUMN_WIDTH);
  }
  bill = block(snapshot.bill_to.email, body, bill, RIGHT_COLUMN_X, COLUMN_WIDTH);
  top = Math.max(from, bill) + 16;

  top = put("Property", label, top, { x: PAGE.margin });
  top = block(snapshot.bill_to.property, body, top, PAGE.margin, CONTENT_WIDTH) + 22;

  // The line, the tax line above the total, the total.
  const money = clean(formatInvoiceAmount(snapshot.currency, snapshot.amount));
  put("Description", label, top, { x: PAGE.margin });
  top = put("Amount", label, top, { right: PAGE.width - PAGE.margin });
  const itemStart = top;
  top = block(snapshot.description, body, itemStart, PAGE.margin, CONTENT_WIDTH - AMOUNT_WIDTH);
  put(money, body, itemStart, { right: PAGE.width - PAGE.margin });
  top = block(snapshot.tax_line, note, top + 8, PAGE.margin, CONTENT_WIDTH) + 8;
  put("Total", total, top, { x: PAGE.margin });
  top = put(money, total, top, { right: PAGE.width - PAGE.margin }) + 22;

  // Payment terms with the late terms under them, then how to pay.
  top = put("Payment terms", label, top, { x: PAGE.margin });
  if (!isBlank(snapshot.terms)) top = block(snapshot.terms, body, top, PAGE.margin, CONTENT_WIDTH);
  top = block(snapshot.late_terms, body, top, PAGE.margin, CONTENT_WIDTH) + 16;

  top = put("How to pay", label, top, { x: PAGE.margin });
  const preferred = snapshot.instructions.find((method) => method.id === snapshot.preferred_method);
  top = block(
    `Preferred method: ${preferred?.label ?? snapshot.preferred_method}`,
    strong,
    top,
    PAGE.margin,
    CONTENT_WIDTH,
  );
  for (const method of snapshot.instructions.filter((entry) => entry.instructions !== "")) {
    top = block(method.label, strong, top + 4, PAGE.margin, CONTENT_WIDTH);
    top = block(method.instructions, body, top, PAGE.margin, CONTENT_WIDTH);
  }
  top = block(
    `Questions about this invoice: ${snapshot.billing_email}`,
    body,
    top + 18,
    PAGE.margin,
    CONTENT_WIDTH,
  );
  block("Editorial acceptance precedes this invoice.", note, top, PAGE.margin, CONTENT_WIDTH);

  if (replaced > 0) logLine("info", "invoice_glyph_replaced", { count: replaced });
  return runs;
}
