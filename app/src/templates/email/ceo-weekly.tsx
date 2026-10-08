import { Heading, Text } from "@react-email/components";
import { render } from "@react-email/render";
import { createElement, type CSSProperties } from "react";
import type { SiteContext } from "../../server/email/context.ts";
import { formatDate } from "../../server/email/format.ts";
import type { RenderedEmail } from "../../server/email/render.ts";
import type { WeeklyKpis } from "../../server/kpi/collect.ts";
import { kpiLines, type KpiLine, type KpiWeek } from "../../server/kpi/definitions.ts";
import { themeHex } from "../theme.gen.ts";
import { fonts, footerLines, Layout } from "./layout.tsx";

// The CEO's weekly numbers (B11 invariant 12): one table of the eight KPIs with their change against the week
// before, then the properties asked about most. Plain on purpose; React Email code, not a template row.

interface CeoWeeklyProps {
  title: string;
  preheader: string;
  period: string;
  lines: readonly KpiLine[];
  top: KpiWeek["inquiries"]["top"];
  site: SiteContext;
}

const text: CSSProperties = {
  margin: "0 0 18px",
  fontFamily: fonts.body,
  fontSize: "14px",
  lineHeight: "1.6",
  color: themeHex.mutedForeground,
};

const cell: CSSProperties = {
  padding: "10px 12px 10px 0",
  borderTop: `1px solid ${themeHex.accent}`,
  fontFamily: fonts.body,
  fontSize: "14px",
  lineHeight: "1.5",
  textAlign: "left",
  verticalAlign: "top",
  color: themeHex.foreground,
};

const head: CSSProperties = {
  ...cell,
  fontSize: "11px",
  fontWeight: "normal",
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: themeHex.mutedForeground,
};

const day = (date: string): string => formatDate(`${date}T00:00:00Z`);

function CeoWeekly({ title, preheader, period, lines, top, site }: CeoWeeklyProps) {
  return (
    <Layout title={title} preheader={preheader} site={site}>
      <Heading
        as="h1"
        style={{
          margin: "0 0 12px",
          fontFamily: fonts.display,
          fontSize: "28px",
          fontWeight: 400,
          color: themeHex.foreground,
        }}
      >
        The week in numbers
      </Heading>
      <Text style={text}>{period}</Text>
      <table style={{ width: "100%", margin: "0 0 22px", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th scope="col" style={head}>
              Measure
            </th>
            <th scope="col" style={head}>
              This week
            </th>
            <th scope="col" style={head}>
              Change
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.key}>
              <th scope="row" style={{ ...cell, fontWeight: "normal" }}>
                {line.label}
              </th>
              <td style={cell}>{line.value}</td>
              <td style={cell}>{line.change}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {top.length === 0 ? null : (
        <>
          <Text style={{ ...text, margin: "0 0 8px" }}>Properties asked about most</Text>
          {top.map((property) => (
            <Text
              key={property.slug}
              style={{ ...text, margin: "0 0 4px", color: themeHex.foreground }}
            >
              {property.title}: {String(property.count)}
            </Text>
          ))}
        </>
      )}
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
