import type { ReactNode } from "react";
import { ART } from "../art.ts";
import { Blocks, emphasised, opening } from "../blocks.tsx";
import { Row } from "../blocks/band.tsx";
import { Colophon } from "../blocks/colophon.tsx";
import { Picture } from "../blocks/picture.tsx";
import { Shell, type EmailProps } from "../layout.tsx";
import { COLUMN, cx, hairline, ink, label, placardTitle, sans, serif, SIDE } from "../style.ts";

// AFTERNOON, the house of correspondence, a letter from us: an invoice, a decision, a note about a privacy request, the
// Place Notes issue (operator, 2026-10-15). One Bone wall in afternoon light, no bands and no boxes, everything hung on
// one centre axis like work in a gallery. It opens on the same door as Threshold, drawn in Afternoon's world (operator:
// "the logo at the top needs to be similar to the one in threshold but the style for it matching the vibe and art style
// of the afternoon one"): the GIF holds the emblem on the wall, dollies in, a blade of sun shows the door ajar, and the
// door opens onto daylight that falls on the floor in the door's own shape. One door in two lights. Then a placard
// (a label, the row's opening as title and italic subtitle), the template's instrument (an invoice's amounts), the
// row's letter and the colophon, centred.

const table = { role: "presentation", cellPadding: 0, cellSpacing: 0, border: 0 } as const;

interface AfternoonProps extends EmailProps {
  /** The placard's label, after a Sandstone square: what this letter is ("Invoice MOP-0001"). */
  label?: string | undefined;
  /** A placard of the template's own in place of the label and the row's opening (Place Notes' nameplate). */
  placard?: ReactNode;
  /** Rows of the column under the placard: what must be exact (an invoice's amounts). */
  instrument?: ReactNode;
  /** Rows of the column after the row's letter (a Place Notes issue, a home's block). */
  after?: ReactNode;
  /** Why this email came, in the colophon's small print. */
  note?: string | undefined;
  /** The unsubscribe address of a commercial email. */
  unsubscribe?: string | undefined;
}

export function Afternoon({
  title,
  preheader,
  site,
  blocks,
  label: kind,
  placard,
  instrument = null,
  after = null,
  note,
  unsubscribe,
}: AfternoonProps) {
  const { lines, rest } = opening(blocks);
  const [heading, subtitle] = lines;
  return (
    <Shell title={title} preheader={preheader} site={site} page={ink.bone}>
      <table
        {...table}
        width="100%"
        className="mop-paper"
        style={{ width: "100%", backgroundColor: ink.bone }}
      >
        <tbody>
          <tr>
            <td align="center">
              <table
                {...table}
                width={COLUMN}
                align="center"
                className="mop-col"
                style={{ maxWidth: `${String(COLUMN)}px` }}
              >
                <tbody>
                  <Row padding="0" align="center" bleed>
                    <Picture
                      src={`${site.siteUrl}${ART.doorDay.path}`}
                      art={ART.doorDay}
                      alt="Matter of Place"
                      paper={ink.bone}
                      ink={ink.obsidian}
                      bleed
                      day
                    />
                    <Picture
                      src={`${site.siteUrl}${ART.doorDayDark.path}`}
                      art={ART.doorDayDark}
                      alt="Matter of Place"
                      paper={ink.obsidian}
                      ink={ink.bone}
                      bleed
                      night
                    />
                  </Row>
                  <Row padding={`14px ${SIDE} 0`} align="center">
                    {placard}
                    {kind === undefined ? null : (
                      <p
                        className={cx(sans.className, "mop-ink", "mop-k", "mop-d4")}
                        style={{
                          ...label,
                          fontSize: "9.5px",
                          color: ink.obsidian,
                          textAlign: "center",
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
                      </p>
                    )}
                    {heading === undefined ? null : (
                      <p
                        className={cx(serif.className, "mop-t-title", "mop-ink")}
                        style={{
                          ...placardTitle,
                          margin: "20px 0 0",
                          color: ink.obsidian,
                          textAlign: "center",
                        }}
                      >
                        <span className="mop-m">
                          <span className={cx("mop-r", "mop-d5")}>{emphasised(heading)}</span>
                        </span>
                      </p>
                    )}
                    {subtitle === undefined ? null : (
                      <p
                        className={cx(serif.className, "mop-ink2")}
                        style={{
                          margin: "6px 0 0",
                          fontFamily: serif.fontFamily,
                          fontSize: "22px",
                          fontWeight: 300,
                          fontStyle: "italic",
                          lineHeight: "28px",
                          color: ink.mineral,
                          textAlign: "center",
                        }}
                      >
                        <span className="mop-m">
                          <span className={cx("mop-r", "mop-d6")}>{subtitle}</span>
                        </span>
                      </p>
                    )}
                    <table {...table} align="center" style={{ margin: "22px auto 0" }}>
                      <tbody>
                        <tr>
                          <td
                            className="mop-hair"
                            width={24}
                            style={{ ...hairline(ink.sandstone), width: "24px" }}
                          >
                            &nbsp;
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </Row>
                  {instrument}
                  {rest.length === 0 ? null : (
                    <Row padding={`44px ${SIDE} 0`} align="center">
                      <Blocks blocks={rest} house="afternoon" />
                    </Row>
                  )}
                  {after}
                  <Row padding="56px 0 0" bleed />
                  <Colophon site={site} align="center" note={note} unsubscribe={unsubscribe} />
                </tbody>
              </table>
            </td>
          </tr>
        </tbody>
      </table>
    </Shell>
  );
}
