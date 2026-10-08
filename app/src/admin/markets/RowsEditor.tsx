import type { ReactNode } from "react";
import { RoleGate } from "../ui/RoleGate";
import { moved } from "./market-values";

/**
 * An ordered list of rows an editor adds, moves and removes: the notes and the guide entries of a market. The order
 * on screen is the order Save sends, which the database stores as `sort_order`. `children` draws the fields of one
 * row; `n` is its place, counted from 1, so the field names stay unique.
 */
export function RowsEditor<Row extends { key: string }>({
  heading,
  noun,
  rows,
  blank,
  onChange,
  children,
}: {
  heading: string;
  noun: string;
  rows: readonly Row[];
  blank: () => Row;
  onChange: (rows: Row[]) => void;
  children: (row: Row, n: number, update: (fields: Partial<Row>) => void) => ReactNode;
}) {
  const name = noun.toLowerCase();
  return (
    <section aria-label={heading} className="admin-editor__fields">
      <h2>{heading}</h2>
      {rows.map((row, index) => (
        <fieldset key={row.key} className="admin-editor__list">
          <legend>{`${noun} ${String(index + 1)}`}</legend>
          {children(row, index + 1, (fields) => {
            onChange(
              rows.map((current, at) => (at === index ? { ...current, ...fields } : current)),
            );
          })}
          <RoleGate action="markets.edit">
            <div className="admin-actions">
              <button
                type="button"
                className="admin-button"
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
                className="admin-button"
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
                className="admin-button"
                aria-label={`Remove ${name} ${String(index + 1)}`}
                onClick={() => {
                  onChange(rows.filter((_, at) => at !== index));
                }}
              >
                Remove
              </button>
            </div>
          </RoleGate>
        </fieldset>
      ))}
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
