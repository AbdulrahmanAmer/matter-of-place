import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SubmissionListRow } from "../../domain/admin-submissions";
import { EmptyState } from "../ui/EmptyState";
import { RequestsTable } from "./RequestsTable";

const NOW = Date.parse("2026-10-06T12:00:00Z");

function row(n: number, overrides: Partial<SubmissionListRow> = {}): SubmissionListRow {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    received_at: "2026-10-01T12:00:00Z",
    address: `${String(n)} Fixture Lane`,
    city: "Montecito",
    state: "California",
    submitter_kind: "agent",
    submitter_name: `Submitter ${String(n)}`,
    brokerage: "Fixture Brokerage",
    package: "The Feature",
    workflow_state: "Submitted",
    accepted_at: null,
    duplicate_of: null,
    turnstile_ok: true,
    property_id: null,
    ...overrides,
  };
}

const empty = <EmptyState title="No requests" />;

/** The cells of the row whose address starts with `address`. */
function rowOf(address: string): HTMLElement {
  const found = screen.getAllByRole("row").find((tr) => tr.textContent.includes(address));
  if (found === undefined) throw new Error(`no row for ${address}`);
  return found;
}

describe("RequestsTable", () => {
  it("shows Possible duplicate, linked to the earlier request, for a row with duplicate_of", () => {
    const earlier = row(1);
    render(
      <RequestsTable
        rows={[earlier, row(2, { duplicate_of: earlier.id })]}
        now={NOW}
        empty={empty}
      />,
    );
    const badge = within(rowOf("2 Fixture Lane")).getByText("Possible duplicate");
    expect(badge.closest("a")?.getAttribute("href")).toBe(`/admin/requests/${earlier.id}`);
    expect(within(rowOf("1 Fixture Lane")).queryByText("Possible duplicate")).toBeNull();
  });

  it("shows Turnstile down for a row with turnstile_ok false", () => {
    render(
      <RequestsTable rows={[row(1), row(2, { turnstile_ok: false })]} now={NOW} empty={empty} />,
    );
    expect(within(rowOf("2 Fixture Lane")).getByText("Turnstile down")).toBeTruthy();
    expect(within(rowOf("1 Fixture Lane")).queryByText("Turnstile down")).toBeNull();
  });

  it("shows the submitter's kind, leaves an owner's brokerage empty and counts the days waiting", () => {
    render(
      <RequestsTable
        rows={[row(1, { submitter_kind: "owner", brokerage: "Kept Anyway" })]}
        now={NOW}
        empty={empty}
      />,
    );
    const cells = within(rowOf("1 Fixture Lane"))
      .getAllByRole("cell")
      .map((cell) => cell.textContent);
    expect(cells.slice(1)).toEqual([
      "1 Fixture Lane",
      "Montecito, California",
      "Submitter 1 Owner",
      "",
      "The Feature",
      "Submitted",
      "5",
    ]);
  });

  it("offers a selection box only on requests still Submitted, and a click on it does not open the row", () => {
    const onToggle = vi.fn();
    const onOpen = vi.fn();
    render(
      <RequestsTable
        rows={[row(1), row(2, { workflow_state: "Under Review" })]}
        now={NOW}
        empty={empty}
        onOpen={onOpen}
        selection={{ ids: new Set(), onToggle }}
      />,
    );
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes.map((box) => box.getAttribute("aria-label"))).toEqual(["Select 1 Fixture Lane"]);
    fireEvent.click(boxes[0] ?? document.body);
    expect({ toggled: onToggle.mock.calls, opened: onOpen.mock.calls.length }).toEqual({
      toggled: [[row(1).id]],
      opened: 0,
    });
  });
});
