import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { InvoiceListRow } from "../../domain/payments";
import { EmptyState } from "../ui/EmptyState";
import { InvoiceFilters } from "./InvoiceFilters";
import { InvoicesTable } from "./InvoicesTable";

function row(n: number, overrides: Partial<InvoiceListRow> = {}): InvoiceListRow {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    invoice_number: `MOP-2026-${String(n).padStart(4, "0")}`,
    submission_id: `00000000-0000-4000-8000-${String(n + 100).padStart(12, "0")}`,
    submitter_name: `Submitter ${String(n)}`,
    submitter_email: "someone@example.test",
    product: "The Feature",
    amount: 295,
    status: "due",
    issued_at: "2026-10-01T12:00:00Z",
    due_at: "2026-10-15T12:00:00Z",
    paid_at: null,
    overdue: false,
    days_open: 5,
    ...overrides,
  };
}

const empty = <EmptyState title="No invoices" />;

function rowOf(text: string): HTMLElement {
  const found = screen.getAllByRole("row").find((tr) => tr.textContent.includes(text));
  if (found === undefined) throw new Error(`no row for ${text}`);
  return found;
}

describe("InvoicesTable", () => {
  it("draws loading rows while the list is on its way", () => {
    const { container } = render(<InvoicesTable rows={[]} loading empty={empty} />);
    expect({
      busy: container.querySelector("section")?.getAttribute("aria-busy"),
      skeletons: container.querySelectorAll(".admin-skeleton").length,
    }).toEqual({ busy: "true", skeletons: 5 });
  });

  it("shows the empty state when there are no invoices", () => {
    render(<InvoicesTable rows={[]} empty={empty} />);
    expect(screen.getByRole("heading", { name: "No invoices" })).toBeTruthy();
  });

  it("marks a due invoice overdue after its 14 days and leaves a younger one alone", () => {
    render(
      <InvoicesTable
        rows={[row(1, { days_open: 15, overdue: true }), row(2, { days_open: 13, overdue: false })]}
        empty={empty}
      />,
    );
    expect({
      late: within(rowOf("MOP-2026-0001"))
        .queryByText("Overdue")
        ?.closest("[data-overdue]")
        ?.getAttribute("data-overdue"),
      young: within(rowOf("MOP-2026-0002")).queryByText("Overdue"),
    }).toEqual({ late: "true", young: null });
  });

  it("reads No invoice for a waiver recorded without a number, and lists no dates for it", () => {
    render(
      <InvoicesTable
        rows={[
          row(3, {
            invoice_number: null,
            status: "waived",
            issued_at: null,
            due_at: null,
            overdue: null,
            days_open: null,
          }),
        ]}
        empty={empty}
      />,
    );
    const cells = within(rowOf("Submitter 3"))
      .getAllByRole("cell")
      .map((cell) => cell.textContent);
    expect(cells).toEqual(["No invoice", "Submitter 3", "The Feature", "$295", "Waived", "", ""]);
  });

  it("names the state of a paid, a waived and a void invoice", () => {
    render(
      <InvoicesTable
        rows={[
          row(4, { status: "paid", paid_at: "2026-10-03T12:00:00Z" }),
          row(5, { status: "waived" }),
          row(6, { status: "void" }),
        ]}
        empty={empty}
      />,
    );
    expect(
      ["MOP-2026-0004", "MOP-2026-0005", "MOP-2026-0006"].map(
        (number) => within(rowOf(number)).getAllByRole("cell")[4]?.textContent,
      ),
    ).toEqual(["Paid", "Waived", "Void"]);
  });
});

describe("InvoiceFilters", () => {
  it("offers every status and carries the overdue box", () => {
    render(<InvoiceFilters values={{ overdue: "true" }} onChange={() => undefined} />);
    expect({
      statuses: within(screen.getByLabelText("Status"))
        .getAllByRole("option")
        .map((option) => option.textContent),
      overdue: screen.getByLabelText<HTMLInputElement>("Overdue only").checked,
    }).toEqual({
      statuses: ["All", "Due", "Paid", "Waived", "Refunded", "Void"],
      overdue: true,
    });
  });
});
