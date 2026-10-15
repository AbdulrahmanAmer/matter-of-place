import { themeHex } from "../../theme.gen.ts";
import { hairline } from "../style.ts";

const table = { role: "presentation", cellPadding: 0, cellSpacing: 0, border: 0 } as const;

/**
 * A hairline across the measure with space around it. The space is padding on a cell, which Outlook keeps where it
 * drops a margin; `className` hooks the line to the motion block (the header's rule draws from left to right).
 */
export function Rule({
  padding,
  color = themeHex.accent,
  className,
}: {
  padding: string;
  color?: string;
  className?: string;
}) {
  return (
    <table {...table} width="100%">
      <tbody>
        <tr>
          <td style={{ padding }}>
            <table {...table} width="100%">
              <tbody>
                <tr>
                  <td className={className} style={{ ...hairline, backgroundColor: color }}>
                    &nbsp;
                  </td>
                </tr>
              </tbody>
            </table>
          </td>
        </tr>
      </tbody>
    </table>
  );
}
