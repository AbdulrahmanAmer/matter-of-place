import { useState, type ReactNode } from "react";
import { useHotkeys } from "./use-hotkeys";

export interface Column<Row> {
  key: string;
  header: string;
  render: (row: Row) => ReactNode;
  align?: "end";
}

/** A saved view is a static preset of filters, named for the job it does ("Needs decision"). */
export interface SavedView {
  id: string;
  label: string;
}

const SKELETON_ROWS = 5;

/**
 * A server-paged list. The filters and the page live in the address (`use-url-filters.ts`), so this draws what
 * it is given: the rows, a pager, the saved views, and `j`, `k` and `Enter` to move and open.
 */
export function DataTable<Row>({
  caption,
  columns,
  rows,
  rowId,
  loading = false,
  error = null,
  empty,
  onOpen,
  pager,
  views,
  toolbar,
}: {
  caption: string;
  columns: readonly Column<Row>[];
  rows: readonly Row[];
  rowId: (row: Row) => string;
  loading?: boolean;
  /** A failed load: the message and, when the server sent one, the request id to quote. */
  error?: { message: string; requestId?: string } | null;
  empty: ReactNode;
  onOpen?: (row: Row) => void;
  pager?: { hasPrevious: boolean; hasNext: boolean; onPrevious: () => void; onNext: () => void };
  views?: {
    items: readonly SavedView[];
    active: string | null;
    onSelect: (id: string | null) => void;
  };
  toolbar?: ReactNode;
}) {
  const [selected, setSelected] = useState(0);
  const current = Math.min(selected, Math.max(rows.length - 1, 0));

  useHotkeys(
    {
      j: () => {
        setSelected(Math.min(current + 1, rows.length - 1));
      },
      k: () => {
        setSelected(Math.max(current - 1, 0));
      },
      Enter: () => {
        const row = rows[current];
        if (row !== undefined) onOpen?.(row);
      },
    },
    rows.length > 0,
  );

  return (
    <section aria-busy={loading}>
      {toolbar === undefined && views === undefined ? null : (
        <div className="admin-toolbar" data-print="hide">
          {views === undefined ? null : (
            <div className="admin-views" role="group" aria-label="Saved views">
              {views.items.map((view) => (
                <button
                  key={view.id}
                  type="button"
                  className="admin-view"
                  aria-pressed={view.id === views.active}
                  onClick={() => {
                    views.onSelect(view.id === views.active ? null : view.id);
                  }}
                >
                  {view.label}
                </button>
              ))}
            </div>
          )}
          {toolbar}
        </div>
      )}
      {error === null ? null : (
        <p role="alert">
          {error.message}
          {error.requestId === undefined ? null : ` Request ${error.requestId}.`}
        </p>
      )}
      {error === null && !loading && rows.length === 0 ? (
        empty
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <caption>{caption}</caption>
            <thead>
              <tr>
                {columns.map((column) => (
                  <th
                    key={column.key}
                    scope="col"
                    className={column.align === "end" ? "admin-cell--end" : undefined}
                  >
                    {column.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading
                ? Array.from({ length: SKELETON_ROWS }, (_, index) => (
                    <tr key={index}>
                      <td colSpan={columns.length}>
                        <div className="admin-skeleton" />
                      </td>
                    </tr>
                  ))
                : rows.map((row, index) => (
                    // Mouse users click the row; the keyboard path is `j`, `k` and `Enter` (use-hotkeys.ts).
                    <tr
                      key={rowId(row)}
                      aria-selected={index === current}
                      data-open={onOpen !== undefined}
                      onClick={() => {
                        setSelected(index);
                        onOpen?.(row);
                      }}
                    >
                      {columns.map((column) => (
                        <td
                          key={column.key}
                          className={column.align === "end" ? "admin-cell--end" : undefined}
                        >
                          {column.render(row)}
                        </td>
                      ))}
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      )}
      {pager === undefined || (!pager.hasPrevious && !pager.hasNext) ? null : (
        <div className="admin-pager" data-print="hide">
          <button
            type="button"
            className="admin-button admin-button--quiet"
            disabled={!pager.hasPrevious}
            onClick={pager.onPrevious}
          >
            Previous
          </button>
          <button
            type="button"
            className="admin-button admin-button--quiet"
            disabled={!pager.hasNext}
            onClick={pager.onNext}
          >
            Next
          </button>
        </div>
      )}
    </section>
  );
}
