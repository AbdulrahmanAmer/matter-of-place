import type { ReactNode } from "react";
import { ART } from "../art.ts";
import { Blocks, emphasised, opening } from "../blocks.tsx";
import { Band, Row } from "../blocks/band.tsx";
import { Colophon } from "../blocks/colophon.tsx";
import { Picture } from "../blocks/picture.tsx";
import { Shell, type EmailProps } from "../layout.tsx";
import { cx, hairline, ink, label, lightTitle, sans, serif, SIDE } from "../style.ts";

// THRESHOLD LIGHT, for the mail the operator and the team read several times a day: an alert, the weekly numbers, a
// campaign report, a forwarded inquiry (operator, 2026-10-15). The same house as Threshold, without its dark cinema:
// one Warm Ivory record shot the width of the window, quick to read, then the Bone colophon. The door is the emblem at
// the size of a line beside the label, set the way Threshold pins its labels; then the row's opening as a title set
// left, the template's instrument (a table of numbers), and the letter.

const table = { role: "presentation", cellPadding: 0, cellSpacing: 0, border: 0 } as const;

interface LightProps extends EmailProps {
  /** What this is, after the emblem and a Sandstone square ("For the team"). */
  label: string;
  /** The right of the header line: the week, the date (hidden on a phone). */
  meta?: string | undefined;
  /** Rows of the column under the title: numbers that must be exact. */
  instrument?: ReactNode;
  /** Rows of the column after the row's letter. */
  after?: ReactNode;
  /** Why this email came, in the colophon's small print. */
  note?: string | undefined;
}

export function Light({
  title,
  preheader,
  site,
  blocks,
  label: kind,
  meta,
  instrument = null,
  after = null,
  note,
}: LightProps) {
  const { lines, rest } = opening(blocks);
  const [heading, subtitle] = lines;
  return (
    <Shell title={title} preheader={preheader} site={site} page={ink.bone}>
      <table {...table} width="100%" style={{ width: "100%" }}>
        <tbody>
          <Band paper="light">
            <Row padding={`40px ${SIDE} 0`}>
              <table {...table} width="100%">
                <tbody>
                  <tr>
                    <td width={ART.emblem.width} style={{ width: `${String(ART.emblem.width)}px` }}>
                      <Picture
                        src={`${site.siteUrl}${ART.emblem.path}`}
                        art={ART.emblem}
                        alt=""
                        paper={ink.ivory}
                        ink={ink.obsidian}
                      />
                    </td>
                    <td
                      className={cx(sans.className, "mop-ink", "mop-k", "mop-d1")}
                      style={{
                        ...label,
                        paddingLeft: "16px",
                        color: ink.obsidian,
                        verticalAlign: "middle",
                        whiteSpace: "nowrap",
                      }}
                    >
                      <span
                        style={{
                          display: "inline-block",
                          width: "6px",
                          height: "6px",
                          backgroundColor: ink.sandstone,
                          verticalAlign: "1px",
                          marginRight: "9px",
                        }}
                      />
                      {kind}
                    </td>
                    {meta === undefined ? null : (
                      <td
                        align="right"
                        className={cx(sans.className, "mop-ink2", "mop-wide")}
                        style={{
                          ...label,
                          color: ink.mineral,
                          textAlign: "right",
                          verticalAlign: "middle",
                        }}
                      >
                        {meta}
                      </td>
                    )}
                  </tr>
                </tbody>
              </table>
            </Row>
            <Row padding={`22px ${SIDE} 0`}>
              <table {...table} width="100%">
                <tbody>
                  <tr>
                    <td className="mop-hair mop-w" style={hairline(ink.sandstone)}>
                      &nbsp;
                    </td>
                  </tr>
                </tbody>
              </table>
            </Row>
            <Row padding={`34px ${SIDE} 0`}>
              {heading === undefined ? null : (
                <p
                  className={cx(serif.className, "mop-t-light", "mop-ink")}
                  style={{ ...lightTitle, color: ink.obsidian }}
                >
                  <span className="mop-m">
                    <span className={cx("mop-r", "mop-d0")}>{emphasised(heading)}</span>
                  </span>
                </p>
              )}
              {subtitle === undefined ? null : (
                <p
                  className={cx(serif.className, "mop-ink2")}
                  style={{
                    margin: "8px 0 0",
                    fontFamily: serif.fontFamily,
                    fontSize: "20px",
                    fontStyle: "italic",
                    lineHeight: "28px",
                    color: ink.mineral,
                  }}
                >
                  {subtitle}
                </p>
              )}
            </Row>
            {instrument}
            {rest.length === 0 ? null : (
              <Row padding={`28px ${SIDE} 0`}>
                <Blocks blocks={rest} house="light" />
              </Row>
            )}
            {after}
            <Row padding="40px 0 0" bleed />
          </Band>
          <Band paper="bone">
            <Colophon site={site} align="left" note={note} />
          </Band>
        </tbody>
      </table>
    </Shell>
  );
}
