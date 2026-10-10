import type { ComponentProps } from "react";
import {
  inquiryIntentLabels,
  inquiryStateLabels,
  inquiryStates,
  type InquiryRow,
} from "../../domain/admin-inquiries";
import { DataTable, type Column } from "../ui/DataTable";
import { EmptyState } from "../ui/EmptyState";
import { Field } from "../ui/Field";
import { LocalTime } from "../ui/LocalTime";
import { StatusPill } from "../ui/StatusPill";
import { stateTone } from "./state-tone";

type Values = Readonly<{ state?: string }>;

type TableProps = ComponentProps<typeof DataTable<InquiryRow>>;

/** An anonymised row keeps no contact fields worth showing (B8 retention, `delete_subject`). */
const contact = (row: InquiryRow, value: string) =>
  row.anonymised_at === null ? value : <StatusPill label="Anonymised" />;

function columns(assigneeName: (id: string) => string): Column<InquiryRow>[] {
  return [
    { key: "intent", header: "Intent", render: (row) => inquiryIntentLabels[row.intent] },
    {
      key: "subject",
      header: "Property",
      render: (row) => row.subject_title ?? row.subject_slug ?? "None",
    },
    { key: "name", header: "Name", render: (row) => contact(row, row.name) },
    { key: "email", header: "Email", render: (row) => contact(row, row.email) },
    {
      key: "received",
      header: "Received",
      render: (row) => <LocalTime value={row.received_at} />,
    },
    {
      key: "state",
      header: "State",
      render: (row) => (
        <StatusPill label={inquiryStateLabels[row.state]} tone={stateTone[row.state]} />
      ),
    },
    {
      key: "assigned",
      header: "Assigned",
      render: (row) => (row.assigned_to === null ? "No one" : assigneeName(row.assigned_to)),
    },
  ];
}

/** Screen 11: the inquiries the public forms sent, newest first; a row opens its drawer. */
export function InquiriesTable({
  filters,
  assigneeName,
  ...table
}: Omit<TableProps, "caption" | "columns" | "rowId" | "empty"> & {
  filters: { values: Values; onChange: (next: Values) => void };
  assigneeName: (id: string) => string;
}) {
  return (
    <>
      <div className="admin-toolbar">
        <Field label="State">
          {(control) => (
            <select
              {...control}
              value={filters.values.state ?? ""}
              onChange={(event) => {
                filters.onChange({ state: event.target.value });
              }}
            >
              <option value="">All</option>
              {inquiryStates.map((state) => (
                <option key={state} value={state}>
                  {inquiryStateLabels[state]}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      <DataTable
        caption="Inquiries"
        columns={columns(assigneeName)}
        rowId={(row) => row.id}
        empty={
          filters.values.state === undefined ? (
            <EmptyState title="No inquiries yet">
              An inquiry appears here when someone writes from the site.
            </EmptyState>
          ) : (
            <EmptyState title="None in this state">Nothing matches this filter.</EmptyState>
          )
        }
        {...table}
      />
    </>
  );
}
