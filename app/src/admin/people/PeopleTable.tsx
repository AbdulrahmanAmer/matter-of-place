import { useState, type ComponentProps } from "react";
import type { PersonListRow } from "../../domain/admin-people";
import { submitterKindLabels, submitterKinds } from "../../domain/contracts";
import { DataTable, type Column } from "../ui/DataTable";
import { EmptyState } from "../ui/EmptyState";
import { Field } from "../ui/Field";
import { LocalTime } from "../ui/LocalTime";
import type { PeopleFilterName } from "./people-queries";

type Values = Readonly<Partial<Record<PeopleFilterName, string>>>;

type TableProps = ComponentProps<typeof DataTable<PersonListRow>>;

/** A link inside a row opens its own target, not the row. */
const stopRow = (event: { stopPropagation: () => void }) => {
  event.stopPropagation();
};

const count = (value: number) => String(value);

const columns: Column<PersonListRow>[] = [
  {
    key: "name",
    header: "Name",
    render: (row) => (
      <a href={`/admin/people/${row.id}`} onClick={stopRow}>
        {row.name}
      </a>
    ),
  },
  { key: "kind", header: "Kind", render: (row) => submitterKindLabels[row.kind] },
  { key: "brokerage", header: "Brokerage", render: (row) => row.brokerage },
  { key: "email", header: "Email", render: (row) => row.email },
  { key: "requests", header: "Requests", align: "end", render: (row) => count(row.requests) },
  { key: "accepted", header: "Accepted", align: "end", render: (row) => count(row.accepted) },
  { key: "published", header: "Published", align: "end", render: (row) => count(row.published) },
  {
    key: "activity",
    header: "Last activity",
    render: (row) => <LocalTime value={row.last_activity_at} style="date" />,
  },
];

/** The kind applies at once; the search applies on Enter. */
function PeopleFilters({ values, onChange }: { values: Values; onChange: (next: Values) => void }) {
  const [search, setSearch] = useState(values.search ?? "");
  return (
    <form
      className="admin-toolbar"
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        onChange({ ...values, search: search.trim() });
      }}
    >
      <Field label="Kind">
        {(control) => (
          <select
            {...control}
            value={values.kind ?? ""}
            onChange={(event) => {
              onChange({ ...values, kind: event.target.value });
            }}
          >
            <option value="">All</option>
            {submitterKinds.map((kind) => (
              <option key={kind} value={kind}>
                {submitterKindLabels[kind]}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Search" hint="Name, email or brokerage">
        {(control) => (
          <input
            {...control}
            type="search"
            value={search}
            maxLength={200}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
          />
        )}
      </Field>
    </form>
  );
}

/** Screen 26: everyone who has submitted, with what came of their requests (invariant 23). */
export function PeopleTable({
  filters,
  ...table
}: Omit<TableProps, "caption" | "columns" | "rowId" | "empty"> & {
  filters: { values: Values; onChange: (next: Values) => void };
}) {
  const filtered = filters.values.search !== undefined || filters.values.kind !== undefined;
  return (
    <>
      <PeopleFilters
        key={filters.values.search ?? ""}
        values={filters.values}
        onChange={filters.onChange}
      />
      <DataTable
        caption="People"
        columns={columns}
        rowId={(row) => row.id}
        empty={
          filtered ? (
            <EmptyState title="No one matches">Nothing matches these filters.</EmptyState>
          ) : (
            <EmptyState title="No one has submitted yet">
              A person appears here with their first request.
            </EmptyState>
          )
        }
        {...table}
      />
    </>
  );
}
