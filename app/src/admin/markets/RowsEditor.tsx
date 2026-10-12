import type { ReactNode } from "react";
import { Fold } from "../ui/Fold";
import { RoleGate } from "../ui/RoleGate";
import { moved } from "./market-values";

/**
 * An ordered list of rows an editor adds, moves and removes: the notes and the guide entries of a market. The order
 * on screen is the order Save sends, which the database stores as `sort_order`. Each row is one line that opens in
 * place (admin pass): `title` names it, `meta` says a word about it, and `children` draws its fields; `n` is its
 * place, counted from 1, so the field names stay unique. A row with no title yet (a new one) opens by itself.
 */
export function RowsEditor<Row extends { key: string }>({
  id,
  heading,
  lead,
  noun,
  rows,
  blank,
  title,
  meta,
  invalid,
  onChange,
  children,
}: {
  id: string;
  heading: string;
  lead: string;
  noun: string;
  rows: readonly Row[];
  blank: () => Row;
  title: (row: Row) => string;
  meta?: (row: Row) => string;
  /** A row that cannot be saved as it is opens by itself, so its message is never folded away. */
  invalid?: (row: Row) => boolean;
  onChange: (rows: Row[]) => void;
  children: (row: Row, n: number, update: (fields: Partial<Row>) => void) => ReactNode;
}) {
  const name = noun.toLowerCase();
  return (
    <section id={id} aria-label={heading} className="admin-editor__fields">
      <h2>{heading}</h2>
      <p className="admin-lead">{lead}</p>
      <div className="admin-folds">
        {rows.map((row, index) => {
          const named = title(row).trim();
          return (
            <Fold
              key={row.key}
              title={named === "" ? `New ${name}` : named}
              open={named === "" || invalid?.(row) === true}
              {...(meta === undefined ? {} : { meta: meta(row) })}
            >
              {children(row, index + 1, (fields) => {
                onChange(
                  rows.map((current, at) => (at === index ? { ...current, ...fields } : current)),
                );
              })}
              <RoleGate action="markets.edit">
                <div className="admin-actions">
                  <button
                    type="button"
                    className="admin-button admin-button--quiet"
                    aria-label={`Move ${name} ${String(index + 1)} up`}
                    disabled={index === 0}
                    onClick={() => {
                      onChange(moved(rows, index, -1));
                    }}
                  >
                    Move up
                  </button>
                  <button
                    type="button"
                    className="admin-button admin-button--quiet"
                    aria-label={`Move ${name} ${String(index + 1)} down`}
                    disabled={index === rows.length - 1}
                    onClick={() => {
                      onChange(moved(rows, index, 1));
                    }}
                  >
                    Move down
                  </button>
                  <button
                    type="button"
                    className="admin-button admin-button--quiet"
                    aria-label={`Remove ${name} ${String(index + 1)}`}
                    onClick={() => {
                      onChange(rows.filter((_, at) => at !== index));
                    }}
                  >
                    Remove
                  </button>
                </div>
              </RoleGate>
            </Fold>
          );
        })}
      </div>
      <RoleGate action="markets.edit">
        <div className="admin-actions">
          <button
            type="button"
            className="admin-button"
            onClick={() => {
              onChange([...rows, blank()]);
            }}
          >
            {`Add ${name}`}
          </button>
        </div>
      </RoleGate>
    </section>
  );
}
