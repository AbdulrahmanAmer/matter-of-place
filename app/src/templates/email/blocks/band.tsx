import type { ReactNode } from "react";
import { COLUMN, PAPER, type Paper } from "../style.ts";

const table = { role: "presentation", cellPadding: 0, cellSpacing: 0, border: 0 } as const;

/**
 * One of Threshold's shots: a band of colour the width of the window, holding the 600 px column; its `children` are
 * the column's rows. A light band takes Apple Mail's night (`mop-paper`); a dark one is already night.
 */
export function Band({ paper, children }: { paper: Paper; children: ReactNode }) {
  const light = paper === "light" || paper === "bone";
  return (
    <tr>
      <td
        align="center"
        className={light ? "mop-paper" : undefined}
        style={{ backgroundColor: PAPER[paper] }}
      >
        <table
          {...table}
          width={COLUMN}
          align="center"
          className="mop-col"
          style={{ maxWidth: `${String(COLUMN)}px` }}
        >
          <tbody>{children}</tbody>
        </table>
      </td>
    </tr>
  );
}

/** A row of a band's column, with its padding; `bleed` rows (a picture) keep their full width on a phone. */
export function Row({
  padding,
  align = "left",
  bleed = false,
  children,
}: {
  padding: string;
  align?: "left" | "right" | "center";
  bleed?: boolean;
  children?: ReactNode;
}) {
  return (
    <tr>
      <td
        className={bleed ? undefined : "mop-px"}
        align={align}
        style={{ padding, textAlign: align }}
      >
        {children}
      </td>
    </tr>
  );
}
