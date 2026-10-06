import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DataTable, type Column } from "./DataTable";
import { EmptyState } from "./EmptyState";
import { useHotkeys } from "./use-hotkeys";

interface Row {
  id: string;
  address: string;
  state: string;
}

const rows: Row[] = [
  { id: "r1", address: "12 Alder Lane", state: "Submitted" },
  { id: "r2", address: "9 Cove Road", state: "Under Review" },
  { id: "r3", address: "40 Pine Court", state: "Accepted" },
];

const columns: Column<Row>[] = [
  { key: "address", header: "Address", render: (row) => row.address },
  { key: "state", header: "State", render: (row) => row.state, align: "end" },
];

const baseProps = {
  caption: "Requests",
  columns,
  rows,
  rowId: (row: Row) => row.id,
  empty: <EmptyState title="Nothing waiting" />,
};

const selected = () => document.querySelector("tr[aria-selected='true']")?.textContent;

describe("DataTable", () => {
  it("shows a page of rows under its headers and opens a row on click", () => {
    const onOpen = vi.fn();
    render(<DataTable {...baseProps} onOpen={onOpen} />);
    expect(screen.getAllByRole("columnheader").map((header) => header.textContent)).toEqual([
      "Address",
      "State",
    ]);
    fireEvent.click(screen.getByText("9 Cove Road"));
    expect(onOpen).toHaveBeenCalledExactlyOnceWith(rows[1]);
  });

  it("pages with Next and Previous, and Previous is off on the first page", () => {
    const onNext = vi.fn();
    const onPrevious = vi.fn();
    render(
      <DataTable
        {...baseProps}
        pager={{ hasPrevious: false, hasNext: true, onPrevious, onNext }}
      />,
    );
    expect(screen.getByRole("button", { name: "Previous" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("shows no pager when there is one page", () => {
    render(
      <DataTable
        {...baseProps}
        pager={{ hasPrevious: false, hasNext: false, onPrevious: vi.fn(), onNext: vi.fn() }}
      />,
    );
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
  });

  it("shows the empty state instead of an empty table", () => {
    render(<DataTable {...baseProps} rows={[]} />);
    expect(screen.getByRole("heading", { name: "Nothing waiting" })).not.toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("shows placeholder rows while loading, and no data rows", () => {
    render(<DataTable {...baseProps} loading />);
    expect(screen.queryByText("12 Alder Lane")).toBeNull();
    expect(document.querySelectorAll(".admin-skeleton").length).toBeGreaterThan(0);
    expect(document.querySelector("section")?.getAttribute("aria-busy")).toBe("true");
  });

  it("shows a failed load with the request id to quote", () => {
    render(
      <DataTable
        {...baseProps}
        rows={[]}
        error={{ message: "The list did not load.", requestId: "req-9" }}
      />,
    );
    expect(screen.getByRole("alert").textContent).toBe("The list did not load. Request req-9.");
    expect(screen.queryByRole("heading", { name: "Nothing waiting" })).toBeNull();
  });

  it("saved views are toggle buttons that report the choice", () => {
    const onSelect = vi.fn();
    const views = {
      items: [
        { id: "needs-decision", label: "Needs decision" },
        { id: "awaiting-assets", label: "Awaiting assets" },
      ],
      active: "needs-decision",
      onSelect,
    };
    render(<DataTable {...baseProps} views={views} />);
    const group = screen.getByRole("group", { name: "Saved views" });
    expect(
      within(group).getByRole("button", { name: "Needs decision" }).getAttribute("aria-pressed"),
    ).toBe("true");
    fireEvent.click(within(group).getByRole("button", { name: "Awaiting assets" }));
    expect(onSelect).toHaveBeenLastCalledWith("awaiting-assets");
    fireEvent.click(within(group).getByRole("button", { name: "Needs decision" }));
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it("j and k move the selected row and Enter opens it", () => {
    const onOpen = vi.fn();
    render(<DataTable {...baseProps} onOpen={onOpen} />);
    expect(selected()).toContain("12 Alder Lane");
    fireEvent.keyDown(window, { key: "j" });
    fireEvent.keyDown(window, { key: "j" });
    fireEvent.keyDown(window, { key: "j" });
    expect(selected()).toContain("40 Pine Court");
    fireEvent.keyDown(window, { key: "k" });
    expect(selected()).toContain("9 Cove Road");
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onOpen).toHaveBeenCalledExactlyOnceWith(rows[1]);
  });

  it("marks its toolbar and pager to be left out of print", () => {
    render(
      <DataTable
        {...baseProps}
        toolbar={<span>Filters</span>}
        pager={{ hasPrevious: true, hasNext: true, onPrevious: vi.fn(), onNext: vi.fn() }}
      />,
    );
    expect(screen.getByText("Filters").closest("[data-print='hide']")).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "Next" }).closest("[data-print='hide']"),
    ).not.toBeNull();
  });
});

function Shortcuts({ onAccept }: { onAccept: () => void }) {
  useHotkeys({ a: onAccept });
  return (
    <>
      <input aria-label="Search" />
      <dialog open>
        <button type="button">Inside</button>
      </dialog>
    </>
  );
}

describe("hotkeys", () => {
  it("run on a key press outside a field", () => {
    const onAccept = vi.fn();
    render(<Shortcuts onAccept={onAccept} />);
    fireEvent.keyDown(document.body, { key: "a" });
    expect(onAccept).toHaveBeenCalledTimes(1);
  });

  it("ignore typing in a field and keys pressed inside a dialog", () => {
    const onAccept = vi.fn();
    render(<Shortcuts onAccept={onAccept} />);
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Search" }), { key: "a" });
    fireEvent.keyDown(screen.getByRole("button", { name: "Inside" }), { key: "a" });
    expect(onAccept).not.toHaveBeenCalled();
  });

  it("ignore a key held with Control or Command", () => {
    const onAccept = vi.fn();
    render(<Shortcuts onAccept={onAccept} />);
    fireEvent.keyDown(document.body, { key: "a", ctrlKey: true });
    fireEvent.keyDown(document.body, { key: "a", metaKey: true });
    expect(onAccept).not.toHaveBeenCalled();
  });

  it("leave Enter to a focused button", () => {
    const onOpen = vi.fn();
    render(
      <DataTable {...baseProps} onOpen={onOpen} toolbar={<button type="button">Filter</button>} />,
    );
    fireEvent.keyDown(screen.getByRole("button", { name: "Filter" }), { key: "Enter" });
    expect(onOpen).not.toHaveBeenCalled();
  });
});
