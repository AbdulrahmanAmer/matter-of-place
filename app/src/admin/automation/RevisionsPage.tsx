import { AdminApiError } from "../ui/admin-fetch";
import { Field } from "../ui/Field";
import { useUrlFilters } from "../ui/use-url-filters";
import { useRevisions } from "./automation-queries";
import { revisionTables } from "./revision-tables";
import { RevisionsTable } from "./RevisionsTable";

/** Screen 21: every change to the five automation tables, with who made it and the way back. */
export function RevisionsPage() {
  const filters = useUrlFilters(["table_name"]);
  const list = useRevisions({
    ...filters.values,
    ...(filters.cursor === null ? {} : { cursor: filters.cursor }),
  });
  const page = list.data;
  const failure = list.error;
  return (
    <>
      <h1>Revisions</h1>
      <p className="admin-recipes__intro">
        Every change to a recipe, an email, a decline reason, a channel or a schedule. Open one to
        see what moved and, when you may, put the earlier values back.
      </p>
      <RevisionsTable
        rows={page?.items ?? []}
        loading={list.isPending}
        error={
          failure === null
            ? null
            : {
                message: failure.message,
                ...(failure instanceof AdminApiError && failure.requestId !== undefined
                  ? { requestId: failure.requestId }
                  : {}),
              }
        }
        toolbar={
          <Field label="Table">
            {(control) => (
              <select
                {...control}
                value={filters.values.table_name ?? ""}
                onChange={(event) => {
                  filters.setFilters({ table_name: event.target.value });
                }}
              >
                <option value="">All</option>
                {Object.entries(revisionTables).map(([name, table]) => (
                  <option key={name} value={name}>
                    {table.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
        }
        pager={{
          hasPrevious: filters.hasPrevious,
          hasNext: page?.next_cursor != null,
          onPrevious: filters.goPrevious,
          onNext: () => {
            if (page?.next_cursor != null) filters.goNext(page.next_cursor);
          },
        }}
      />
    </>
  );
}
