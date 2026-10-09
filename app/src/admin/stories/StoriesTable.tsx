import type { ComponentProps } from "react";
import { editorialStateLabels, editorialStates } from "../../domain/contracts";
import type { StoryListRow } from "../../domain/admin-stories";
import { DataTable, type Column } from "../ui/DataTable";
import { EmptyState } from "../ui/EmptyState";
import { Field } from "../ui/Field";
import { LocalTime } from "../ui/LocalTime";
import { StatusPill, type Tone } from "../ui/StatusPill";
import { marketNames } from "./story-values";

type Values = Readonly<{ editorial_state?: string }>;

type TableProps = ComponentProps<typeof DataTable<StoryListRow>>;

const tone: Record<StoryListRow["editorial_state"], Tone> = {
  draft: "neutral",
  review: "warning",
  agent_review: "warning",
  published: "ok",
  archived: "neutral",
};

/** A link inside a row opens its own target, not the row. */
const stopRow = (event: { stopPropagation: () => void }) => {
  event.stopPropagation();
};

const columns: Column<StoryListRow>[] = [
  {
    key: "title",
    header: "Title",
    render: (row) => (
      <a href={`/admin/stories/${row.id}`} onClick={stopRow}>
        {row.title}
      </a>
    ),
  },
  { key: "category", header: "Category", render: (row) => row.category },
  { key: "market", header: "Market", render: (row) => marketNames[row.market_slug] },
  {
    key: "state",
    header: "State",
    render: (row) => (
      <StatusPill
        label={editorialStateLabels[row.editorial_state]}
        tone={tone[row.editorial_state]}
      />
    ),
  },
  {
    key: "image",
    header: "Image",
    render: (row) => (row.image === null ? "None yet" : "Ready"),
  },
  {
    key: "updated",
    header: "Edited",
    render: (row) => <LocalTime value={row.updated_at} marketSlug={row.market_slug} style="date" />,
  },
];

/** Screen 14: every story, last edited first (invariant 17c). */
export function StoriesTable({
  filters,
  ...table
}: Omit<TableProps, "caption" | "columns" | "rowId" | "empty"> & {
  filters: { values: Values; onChange: (next: Values) => void };
}) {
  return (
    <>
      <div className="admin-toolbar" role="search">
        <Field label="State">
          {(control) => (
            <select
              {...control}
              value={filters.values.editorial_state ?? ""}
              onChange={(event) => {
                filters.onChange({ editorial_state: event.target.value });
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
      </div>
      <DataTable
        caption="Stories"
        columns={columns}
        rowId={(row) => row.id}
        empty={
          filters.values.editorial_state === undefined ? (
            <EmptyState title="No stories yet">A story starts with New story, above.</EmptyState>
          ) : (
            <EmptyState title="No story in this state">Nothing matches this filter.</EmptyState>
          )
        }
        {...table}
      />
    </>
  );
}
