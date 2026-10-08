import type { ComponentProps } from "react";
import type { PropertyListRow } from "../../domain/admin-properties";
import { editorialStateLabels, editorialStates } from "../../domain/contracts";
import { marketSlugSchema } from "../../domain/market";
import { DataTable, type Column } from "../ui/DataTable";
import { EmptyState } from "../ui/EmptyState";
import { Field } from "../ui/Field";
import { LocalTime } from "../ui/LocalTime";
import { StatusPill } from "../ui/StatusPill";
import type { PropertyFilterName } from "./properties-queries";

type Values = Readonly<Partial<Record<PropertyFilterName, string>>>;

type TableProps = ComponentProps<typeof DataTable<PropertyListRow>>;

const marketNames: Record<string, string> = {
  california: "California",
  "new-york": "New York",
  florida: "Florida",
};

/** A link inside a row opens its own target, not the row. */
const stopRow = (event: { stopPropagation: () => void }) => {
  event.stopPropagation();
};

const rank = (value: number | null) => (value === null ? "" : String(value));

const columns: Column<PropertyListRow>[] = [
  {
    key: "title",
    header: "Title",
    render: (row) => (
      <a href={`/admin/properties/${row.id}`} onClick={stopRow}>
        {row.title}
      </a>
    ),
  },
  {
    key: "place",
    header: "Market and region",
    render: (row) =>
      [marketNames[row.market_slug] ?? row.market_slug, row.region_slug]
        .filter((part) => part !== null)
        .join(", "),
  },
  {
    key: "state",
    header: "State",
    render: (row) => <StatusPill label={editorialStateLabels[row.editorial_state]} />,
  },
  { key: "tier", header: "Tier", render: (row) => row.campaign_tier },
  {
    key: "ranks",
    header: "Hero and featured rank",
    render: (row) => `${rank(row.hero_rank)} / ${rank(row.featured_rank)}`,
  },
  {
    key: "published",
    header: "Published",
    render: (row) =>
      row.published_at === null ? (
        ""
      ) : (
        <LocalTime value={row.published_at} marketSlug={row.market_slug} style="date" />
      ),
  },
  { key: "source", header: "Source", render: (row) => row.source },
];

/** Both filters apply at once. */
function PropertyFilters({
  values,
  onChange,
}: {
  values: Values;
  onChange: (next: Values) => void;
}) {
  return (
    <div className="admin-toolbar" role="search">
      <Field label="State">
        {(control) => (
          <select
            {...control}
            value={values.editorial_state ?? ""}
            onChange={(event) => {
              onChange({ ...values, editorial_state: event.target.value });
            }}
          >
            <option value="">All</option>
            {editorialStates.map((state) => (
              <option key={state} value={state}>
                {editorialStateLabels[state]}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Market">
        {(control) => (
          <select
            {...control}
            value={values.market ?? ""}
            onChange={(event) => {
              onChange({ ...values, market: event.target.value });
            }}
          >
            <option value="">All</option>
            {marketSlugSchema.options.map((market) => (
              <option key={market} value={market}>
                {marketNames[market]}
              </option>
            ))}
          </select>
        )}
      </Field>
    </div>
  );
}

/** Screen 7: every property, last edited first (invariant 17c). */
export function PropertiesTable({
  filters,
  ...table
}: Omit<TableProps, "caption" | "columns" | "rowId" | "empty"> & {
  filters: { values: Values; onChange: (next: Values) => void };
}) {
  const filtered =
    filters.values.editorial_state !== undefined || filters.values.market !== undefined;
  return (
    <>
      <PropertyFilters values={filters.values} onChange={filters.onChange} />
      <DataTable
        caption="Properties"
        columns={columns}
        rowId={(row) => row.id}
        empty={
          filtered ? (
            <EmptyState title="No property matches">Nothing matches these filters.</EmptyState>
          ) : (
            <EmptyState title="No properties yet">
              A property starts from an accepted request, below.
            </EmptyState>
          )
        }
        {...table}
      />
    </>
  );
}
