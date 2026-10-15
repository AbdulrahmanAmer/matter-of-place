import { render } from "@react-email/render";
import { createElement, type CSSProperties } from "react";
import type { SiteContext } from "../../server/email/context.ts";
import { formatDate } from "../../server/email/format.ts";
import type { RenderedEmail } from "../../server/email/render.ts";
import type { WeeklyKpis } from "../../server/kpi/collect.ts";
import { kpiLines, type KpiLine, type KpiWeek } from "../../server/kpi/definitions.ts";
import { Row } from "./blocks/band.tsx";
import { Light } from "./house/light.tsx";
import { footerLines } from "./layout.tsx";
import { cx, GUTTER, ink, label, reading, sans, serif } from "./style.ts";

// The CEO's weekly numbers (B11 invariant 12), internal mail in the light house: one table of the eight KPIs with their
// change against the week before, then the properties asked about most. React Email code, not a template row: the
// measures in Jost, read across a Sandstone hairline per row, the way the light house sets facts.

interface CeoWeeklyProps {
  title: string;
  preheader: string;
  period: string;
  lines: readonly KpiLine[];
  top: KpiWeek["inquiries"]["top"];
  site: SiteContext;
}

const rule = `1px solid ${ink.sandstone}`;

const cell: CSSProperties = {
  padding: "11px 12px 11px 0",
  borderTop: rule,
  fontFamily: sans.fontFamily,
  fontSize: "14px",
  lineHeight: "21px",
  textAlign: "left",
  verticalAlign: "top",
  color: ink.obsidian,
};

const head: CSSProperties = {
  ...label,
  ...cell,
  fontSize: "9.5px",
  letterSpacing: "0.28em",
  color: ink.mineral,
};

const day = (date: string): string => formatDate(`${date}T00:00:00Z`);

function Numbers({ period, lines, top }: Pick<CeoWeeklyProps, "period" | "lines" | "top">) {
  return (
    <Row padding={`22px ${String(GUTTER)}px 0`}>
      <p
        className={cx(serif.className, "mop-t-read", "mop-ink2")}
        style={{
          ...reading,
          fontSize: "18px",
          lineHeight: "28px",
          margin: "0 0 24px",
          color: ink.mineral,
        }}
      >
        {period}
      </p>
      <table style={{ width: "100%", margin: "0 0 30px", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th scope="col" className={cx(sans.className, "mop-ruled")} style={head}>
              Measure
            </th>
            <th scope="col" className={cx(sans.className, "mop-ruled")} style={head}>
              This week
            </th>
            <th scope="col" className={cx(sans.className, "mop-ruled")} style={head}>
              Change
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.key}>
              <th
                scope="row"
                className={cx(sans.className, "mop-ruled", "mop-ink")}
                style={{ ...cell, fontWeight: "normal" }}
              >
                {line.label}
              </th>
              <td className={cx(sans.className, "mop-ruled", "mop-ink")} style={cell}>
                {line.value}
              </td>
              <td
                className={cx(sans.className, "mop-ruled", "mop-ink2")}
                style={{ ...cell, color: ink.mineral }}
              >
                {line.change}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {top.length === 0 ? null : (
        <>
          <p
            className={cx(sans.className, "mop-ink2")}
            style={{ ...label, margin: "0 0 10px", color: ink.mineral }}
          >
            Properties asked about most
          </p>
          {top.map((property) => (
            <p
              key={property.slug}
              className={cx(serif.className, "mop-t-read", "mop-ink")}
              style={{
                ...reading,
                fontSize: "18px",
                lineHeight: "28px",
                margin: "0 0 4px",
                color: ink.obsidian,
              }}
            >
              {property.title}: {String(property.count)}
            </p>
          ))}
        </>
      )}
    </Row>
  );
}

function CeoWeekly({ title, preheader, period, lines, top, site }: CeoWeeklyProps) {
  return (
    <Light
      title={title}
      preheader={preheader}
      site={site}
      blocks={[{ type: "heading", text: "The week in numbers" }]}
      variables={{}}
      label="For the team"
      instrument={<Numbers period={period} lines={lines} top={top} />}
      note="Sent to the team every Monday by the Matter of Place admin."
    />
  );
}

/** The weekly email of `kpis`, as HTML and as plain text with the same lines. */
export async function renderCeoWeekly(kpis: WeeklyKpis, site: SiteContext): Promise<RenderedEmail> {
  const { current, previous } = kpis;
  const lines = kpiLines(current, previous);
  const period = `Monday ${day(current.week_start)} to Sunday ${day(current.week_end)}, New York time. Each change is against the week before.`;
  const title = `The week in numbers: ${day(current.week_start)}`;
  const preheader = `${String(current.submissions_received)} submissions received, ${String(current.decisions.accepted)} accepted.`;
  const top = current.inquiries.top;
  const html = await render(
    createElement(CeoWeekly, { title, preheader, period, lines, top, site }),
  );
  const textPart = [
    period,
    ...lines.map((line) => `${line.label}: ${line.value} (${line.change})`),
    ...(top.length === 0
      ? []
      : [
          "Properties asked about most",
          ...top.map((property) => `${property.title}: ${String(property.count)}`),
        ]),
    ...footerLines(site),
  ].join("\n\n");
  return { subject: title, preheader, html, text: `${textPart}\n` };
}
