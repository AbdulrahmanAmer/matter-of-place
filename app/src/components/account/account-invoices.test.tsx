import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { AccountInvoice } from "../../domain/account";
import { AccountInvoices } from "./account-invoices";

// W6 item 8, Invoices: owed and paid, a waiver as no charge, and a pay link only when Stripe provides one.

const base = {
  city: "Malibu",
  product: "The Feature",
  amount: 295,
  currency: "USD",
  invoice_number: null,
  issued_at: null,
  due_at: null,
  paid_at: null,
  credit: false,
  pay_url: null,
} as const;

const owed: AccountInvoice = {
  ...base,
  id: "00000000-0000-4000-8000-0000000000d1",
  address: "1 Owed Way",
  status: "due",
  invoice_number: "MOP-2026-0007",
  issued_at: "2026-10-01T10:00:00+00:00",
  due_at: "2026-10-15T10:00:00+00:00",
};

const paid: AccountInvoice = {
  ...base,
  id: "00000000-0000-4000-8000-0000000000d2",
  address: "2 Paid Way",
  status: "paid",
  invoice_number: "MOP-2026-0006",
  issued_at: "2026-09-20T10:00:00+00:00",
  paid_at: "2026-09-25T10:00:00+00:00",
};

const credit: AccountInvoice = {
  ...base,
  id: "00000000-0000-4000-8000-0000000000d3",
  address: "3 Credit Way",
  status: "waived",
  product: "Five Features",
  amount: 250,
  credit: true,
};

const comp: AccountInvoice = {
  ...credit,
  id: "00000000-0000-4000-8000-0000000000d4",
  credit: false,
};

const rows = () => within(screen.getByRole("table")).getAllByRole("row").slice(1);

describe("AccountInvoices", () => {
  it("lists what is owed and what is paid with the amount, the number and the day", () => {
    render(<AccountInvoices invoices={[owed, paid]} />);
    expect(rows().map((row) => row.textContent)).toEqual([
      "1 Owed Way, MalibuMOP-2026-0007Oct 1, 2026 ET$295Due Oct 15, 2026 ET",
      "2 Paid Way, MalibuMOP-2026-0006Sep 20, 2026 ET$295Paid Sep 25, 2026 ET",
    ]);
  });

  it("shows a spent credit as covered by the credit and any other waiver as no charge", () => {
    render(<AccountInvoices invoices={[credit, comp]} />);
    expect(rows().map((row) => row.textContent)).toEqual([
      "3 Credit Way, MalibuNo invoice$250Covered by a Five Features credit",
      "3 Credit Way, MalibuNo invoice$250No charge",
    ]);
  });

  it("says refunded for money given back and cancelled for a voided invoice", () => {
    render(
      <AccountInvoices
        invoices={[
          { ...paid, status: "refunded" },
          { ...owed, id: "00000000-0000-4000-8000-0000000000d6", status: "void" },
        ]}
      />,
    );
    expect(rows().map((row) => row.textContent)).toEqual([
      "2 Paid Way, MalibuMOP-2026-0006Sep 20, 2026 ET$295Refunded",
      "1 Owed Way, MalibuMOP-2026-0007Oct 1, 2026 ET$295Cancelled",
    ]);
  });

  it("offers a pay link on an invoice that is due and has one, and on no other", () => {
    render(
      <AccountInvoices
        invoices={[
          { ...owed, pay_url: "https://pay.example.test/owed" },
          { ...paid, pay_url: "https://pay.example.test/paid" },
          { ...owed, id: "00000000-0000-4000-8000-0000000000d5", address: "5 Plain Way" },
        ]}
      />,
    );
    expect(
      screen
        .getAllByRole("link", { name: "Pay this invoice" })
        .map((link) => link.getAttribute("href")),
    ).toEqual(["https://pay.example.test/owed"]);
  });

  it("has no pay link while Stripe provides none", () => {
    render(<AccountInvoices invoices={[owed]} />);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("says so when there is no invoice yet", () => {
    render(<AccountInvoices invoices={[]} />);
    expect(
      screen.getByText("Nothing here yet. An invoice we send you also appears here."),
    ).toBeTruthy();
  });
});
