import type { ComponentProps } from "react";
import type { SubmissionListRow } from "../../domain/admin-submissions";
import type { WorkflowState } from "../../domain/workflow";
import { DataTable, type Column } from "../ui/DataTable";
import { LocalTime } from "../ui/LocalTime";
import { StatusPill, type Tone } from "../ui/StatusPill";

const DAY_MS = 86_400_000;

const stateTone: Record<WorkflowState, Tone> = {
  Submitted: "info",
  "Under Review": "warning",
  "Awaiting Assets": "warning",
  Accepted: "ok",
  "Invoice Issued": "ok",
  Scheduled: "ok",
  Published: "ok",
  "Distribution Active": "ok",
  Completed: "neutral",
  Declined: "neutral",
  Withdrawn: "neutral",
};

const marketSlug: Record<SubmissionListRow["state"], string> = {
  California: "california",
  "New York": "new-york",
  Florida: "florida",
};

/** A link inside a row opens its own target, not the row. */
const stopRow = (event: { stopPropagation: () => void }) => {
  event.stopPropagation();
};

type TableProps = ComponentProps<typeof DataTable<SubmissionListRow>>;

/**
 * Screen 3's table. `now` fixes "days waiting" for one render. With `selection`, each request still `Submitted` gets
 * a box for the bulk start of review.
 */
export function RequestsTable({
  rows,
  now,
  selection,
  ...table
}: Omit<TableProps, "caption" | "columns" | "rowId" | "rows"> & {
  rows: readonly SubmissionListRow[];
  now: number;
  selection?: { ids: ReadonlySet<string>; onToggle: (id: string) => void };
}) {
  const columns: Column<SubmissionListRow>[] = [
    ...(selection === undefined
      ? []
      : [
          {
            key: "select",
            header: "Select",
            render: (row: SubmissionListRow) =>
              row.workflow_state === "Submitted" ? (
                <input
                  type="checkbox"
                  aria-label={`Select ${row.address}`}
                  checked={selection.ids.has(row.id)}
                  onClick={stopRow}
                  onChange={() => {
                    selection.onToggle(row.id);
                  }}
                />
              ) : null,
          },
        ]),
    {
      key: "received",
      header: "Received",
      render: (row) => (
        <LocalTime value={row.received_at} marketSlug={marketSlug[row.state]} style="date" />
      ),
    },
    {
      key: "address",
      header: "Address",
      render: (row) => (
        <>
          {row.address}
          {row.duplicate_of === null ? null : (
            <>
              {" "}
              <a href={`/admin/requests/${row.duplicate_of}`} onClick={stopRow}>
                <StatusPill label="Possible duplicate" tone="warning" />
              </a>
            </>
          )}
          {row.turnstile_ok ? null : (
            <>
              {" "}
              <StatusPill label="Turnstile down" tone="danger" />
            </>
          )}
        </>
      ),
    },
    { key: "place", header: "City and state", render: (row) => `${row.city}, ${row.state}` },
    {
      key: "submitter",
      header: "Submitter",
      render: (row) => (
        <>
          {row.submitter_name}{" "}
          <StatusPill label={row.submitter_kind === "agent" ? "Agent" : "Owner"} />
        </>
      ),
    },
    {
      key: "brokerage",
      header: "Brokerage",
      render: (row) => (row.submitter_kind === "agent" ? row.brokerage : null),
    },
    { key: "package", header: "Package", render: (row) => row.package },
    {
      key: "state",
      header: "State",
      render: (row) => (
        <StatusPill label={row.workflow_state} tone={stateTone[row.workflow_state]} />
      ),
    },
    {
      key: "waiting",
      header: "Days waiting",
      align: "end",
      render: (row) =>
        String(Math.max(0, Math.floor((now - Date.parse(row.received_at)) / DAY_MS))),
    },
  ];
  return (
    <DataTable
      caption="Requests"
      columns={columns}
      rows={rows}
      rowId={(row) => row.id}
      {...table}
    />
  );
}
