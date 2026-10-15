import { cx, hairline, ink, label, sans, serif, stackLine } from "../style.ts";

const table = { role: "presentation", cellPadding: 0, cellSpacing: 0, border: 0 } as const;

/** Where a home stands, as Threshold's typeset stack: the steps in order, and the one this email is about. */
export interface StageSpec {
  steps: readonly string[];
  at: number;
}

const two = (n: number): string => String(n).padStart(2, "0");

/**
 * The record shot's stack (operator's choice of Threshold, 2026-10-15): the film's dash counter ("02 / 03"), then each
 * step on its own line, the steps done in Mineral Grey, this one in italic Obsidian, those still to come in Sandstone,
 * as the film leaves the homes it declines as outlines. Fixed words of the design, as a masthead's are; the row's
 * blocks follow it.
 */
export function Stage({ steps, at }: StageSpec) {
  const colour = (index: number): string =>
    index < at ? ink.mineral : index === at ? ink.obsidian : ink.sandstone;
  const night = (index: number): string =>
    index < at ? "mop-ink2" : index === at ? "mop-ink" : "mop-fut";
  return (
    <>
      <table {...table}>
        <tbody>
          <tr>
            {/* The dashes sit in a table of their own: cells of one row share its height, and the counter's line
                would draw every dash as a block. */}
            <td style={{ verticalAlign: "middle" }}>
              <table {...table}>
                <tbody>
                  <tr>
                    {steps.flatMap((step, index) => [
                      ...(index === 0
                        ? []
                        : [
                            <td
                              key={`${step}-gap`}
                              width={8}
                              style={{
                                width: "8px",
                                height: "2px",
                                fontSize: "1px",
                                lineHeight: "2px",
                              }}
                            >
                              &nbsp;
                            </td>,
                          ]),
                      <td
                        key={step}
                        className={index <= at ? "mop-dash" : "mop-hair"}
                        width={44}
                        height={2}
                        style={{
                          ...hairline(index <= at ? ink.obsidian : ink.sandstone, 2),
                          width: "44px",
                        }}
                      >
                        &nbsp;
                      </td>,
                    ])}
                  </tr>
                </tbody>
              </table>
            </td>
            <td
              className={cx(sans.className, "mop-ink2")}
              style={{ ...label, paddingLeft: "18px", color: ink.mineral, whiteSpace: "nowrap" }}
            >
              {`${two(at + 1)} / ${two(steps.length)}`}
            </td>
          </tr>
        </tbody>
      </table>
      <table {...table} width="100%">
        <tbody>
          <tr>
            <td style={{ padding: "30px 0 38px" }}>
              {steps.map((step, index) => (
                <p
                  key={step}
                  className={cx(serif.className, "mop-t-stack", night(index))}
                  style={{
                    ...stackLine,
                    color: colour(index),
                    fontStyle: index === at ? "italic" : "normal",
                  }}
                >
                  <span className="mop-m">
                    <span className={cx("mop-r", `mop-d${String(Math.min(index, 2))}`)}>
                      {step}
                    </span>
                  </span>
                </p>
              ))}
            </td>
          </tr>
        </tbody>
      </table>
    </>
  );
}
