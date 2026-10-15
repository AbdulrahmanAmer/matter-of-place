import type { CSSProperties } from "react";
import { cx, figure, GUTTER, ink, label, NARROW, sans, serif, value } from "../style.ts";
import { Row } from "./band.tsx";

/**
 * An invoice's amounts, exact (operator, 2026-10-15: "borrow Proof's precise aligned amounts table ... inside
 * Afternoon's calm"): the item and its amount on one ruled line, the home under the item in capitals, and the total due
 * set large and aligned right, with lining, tabular figures. A data table on Afternoon's axis, so its headings are
 * header cells; drawn from the invoice's own variables, never from words an editor can change.
 */
export function Ledger({ item, detail, amount }: { item: string; detail: string; amount: string }) {
  const head: CSSProperties = {
    ...label,
    fontSize: "9.5px",
    letterSpacing: "0.28em",
    color: ink.mineral,
    padding: "0 0 10px",
    borderBottom: `1px solid ${ink.obsidian}`,
  };
  const figures: CSSProperties = {
    fontVariantNumeric: "lining-nums tabular-nums",
    whiteSpace: "nowrap",
  };
  return (
    <Row padding={`52px ${String(GUTTER)}px 0`} align="center">
      <table
        cellPadding={0}
        cellSpacing={0}
        border={0}
        align="center"
        width={NARROW}
        className="mop-narrow"
        style={{ width: `${String(NARROW)}px`, margin: "0 auto", borderCollapse: "collapse" }}
      >
        <tbody>
          <tr>
            <th
              scope="col"
              className={cx(sans.className, "mop-ink2", "mop-ruled")}
              style={{ ...head, textAlign: "left" }}
            >
              Item
            </th>
            <th
              scope="col"
              className={cx(sans.className, "mop-ink2", "mop-ruled")}
              style={{ ...head, textAlign: "right" }}
            >
              Amount
            </th>
          </tr>
          <tr>
            <td
              className="mop-ruled"
              style={{
                padding: "16px 12px 16px 0",
                borderBottom: `1px solid ${ink.sandstone}`,
                textAlign: "left",
                verticalAlign: "top",
              }}
            >
              <p
                className={cx(serif.className, "mop-ink")}
                style={{ ...value, color: ink.obsidian }}
              >
                {item}
              </p>
              <p
                className={cx(sans.className, "mop-ink2")}
                style={{
                  ...label,
                  fontSize: "9.5px",
                  letterSpacing: "0.28em",
                  margin: "4px 0 0",
                  color: ink.mineral,
                }}
              >
                {detail}
              </p>
            </td>
            <td
              className={cx(serif.className, "mop-ruled", "mop-ink")}
              style={{
                ...value,
                ...figures,
                padding: "16px 0",
                borderBottom: `1px solid ${ink.sandstone}`,
                color: ink.obsidian,
                textAlign: "right",
                verticalAlign: "top",
              }}
            >
              {amount}
            </td>
          </tr>
          <tr>
            <th
              scope="row"
              className={cx(sans.className, "mop-ink")}
              style={{
                ...label,
                fontSize: "9.5px",
                letterSpacing: "0.28em",
                color: ink.obsidian,
                padding: "22px 0 6px",
                textAlign: "left",
                verticalAlign: "bottom",
              }}
            >
              Total due
            </th>
            <td
              className={cx(serif.className, "mop-t-total", "mop-ink")}
              style={{
                ...figure,
                padding: "14px 0 0",
                color: ink.obsidian,
                textAlign: "right",
                verticalAlign: "bottom",
              }}
            >
              {amount}
            </td>
          </tr>
        </tbody>
      </table>
    </Row>
  );
}
