import { render } from "@react-email/render";
import { createElement, type CSSProperties } from "react";
import type { SiteContext } from "../../server/email/context.ts";
import { formatDate } from "../../server/email/format.ts";
import type { RenderedEmail } from "../../server/email/render.ts";
import type { WeeklyKpis } from "../../server/kpi/collect.ts";
import { kpiLines, type KpiLine, type KpiWeek } from "../../server/kpi/definitions.ts";
import { themeHex } from "../theme.gen.ts";
import { footerLines, Layout } from "./layout.tsx";
import { cx, display, label, reading, sans, serif } from "./style.ts";

// The CEO's weekly numbers (B11 invariant 12): one table of the eight KPIs with their change against the week
// before, then the properties asked about most. React Email code, not a template row, set in the shell's faces: the
// measures in Jost, read across a Sandstone hairline per row.

interface CeoWeeklyProps {
  title: string;
  preheader: string;
  period: string;
  lines: readonly KpiLine[];
  top: KpiWeek["inquiries"]["top"];
  site: SiteContext;
}

const rule = `1px solid ${themeHex.accent}`;

const cell: CSSProperties = {
  padding: "12px 12px 12px 0",
  borderTop: rule,
  fontFamily: sans.fontFamily,
  fontSize: "14px",
  lineHeight: "1.5",
  textAlign: "left",
  verticalAlign: "top",
  color: themeHex.foreground,
};

const head: CSSProperties = {
  ...label,
  ...cell,
  fontSize: "10px",
  color: themeHex.mutedForeground,
};

const day = (date: string): string => formatDate(`${date}T00:00:00Z`);

function CeoWeekly({ title, preheader, period, lines, top, site }: CeoWeeklyProps) {
  return (
    <Layout title={title} preheader={preheader} site={site} label="For the team">
      <div style={{ overflow: "hidden", padding: "0 0 6px", margin: "0 0 16px" }}>
        <h1 className={cx(serif.className, "mop-display", "mop-rise")} style={display}>
          The week in <em style={{ fontStyle: "italic" }}>numbers</em>
        </h1>
      </div>
      <div className="mop-follow">
        <p
          className={cx(serif.className, "mop-reading")}
          style={{ ...reading, margin: "0 0 26px" }}
        >
          {period}
        </p>
        <table style={{ width: "100%", margin: "0 0 30px", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th scope="col" className={sans.className} style={head}>
                Measure
              </th>
              <th scope="col" className={sans.className} style={head}>
                This week
              </th>
              <th scope="col" className={sans.className} style={head}>
                Change
              </th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.key}>
                <th
                  scope="row"
                  className={sans.className}
                  style={{ ...cell, fontWeight: "normal" }}
                >
                  {line.label}
                </th>
                <td className={sans.className} style={cell}>
                  {line.value}
                </td>
                <td className={sans.className} style={{ ...cell, color: themeHex.mutedForeground }}>
                  {line.change}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {top.length === 0 ? null : (
          <>
            <p className={sans.className} style={{ ...label, margin: "0 0 10px" }}>
              Properties asked about most
            </p>
            {top.map((property) => (
              <p
                key={property.slug}
                className={cx(serif.className, "mop-reading")}
                style={{ ...reading, margin: "0 0 4px", color: themeHex.foreground }}
              >
                {property.title}: {String(property.count)}
              </p>
            ))}
          </>
        )}
      </div>
    </Layout>
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
