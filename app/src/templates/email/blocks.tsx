import { Button, Heading, Text } from "@react-email/components";
import type { CSSProperties } from "react";
import type { EmailBlock } from "../../domain/email.ts";
import { themeHex } from "../theme.gen.ts";
import { fonts, Layout, type EmailProps } from "./layout.tsx";

// The block model of architecture 3.5 as React Email components. Every string arrives interpolated, so a component
// only draws; it reads no variable and drops nothing (`renderTemplate` dropped the empty blocks).

/** What a signature block says when its row gives no text. */
export const SIGNATURE = "Matter of Place";

const HEADINGS = [
  { as: "h1", size: "34px" },
  { as: "h2", size: "26px" },
  { as: "h3", size: "21px" },
] as const;

const paragraph: CSSProperties = {
  margin: "0 0 18px",
  fontFamily: fonts.body,
  fontSize: "15px",
  lineHeight: "1.7",
  color: themeHex.foreground,
};

const button: CSSProperties = {
  margin: "10px 0 22px",
  padding: "16px 34px",
  backgroundColor: themeHex.foreground,
  color: themeHex.background,
  fontFamily: fonts.body,
  fontSize: "12px",
  letterSpacing: "0.18em",
  textTransform: "uppercase",
  textDecoration: "none",
};

const factLabel: CSSProperties = {
  padding: "12px 16px 12px 0",
  borderTop: `1px solid ${themeHex.accent}`,
  fontFamily: fonts.body,
  fontSize: "11px",
  fontWeight: "normal",
  letterSpacing: "0.14em",
  textAlign: "left",
  textTransform: "uppercase",
  verticalAlign: "top",
  color: themeHex.mutedForeground,
};

const factValue: CSSProperties = {
  padding: "11px 0",
  borderTop: `1px solid ${themeHex.accent}`,
  fontFamily: fonts.body,
  fontSize: "15px",
  lineHeight: "1.5",
  verticalAlign: "top",
  color: themeHex.foreground,
};

const signature: CSSProperties = {
  margin: "28px 0 0",
  fontFamily: fonts.display,
  fontSize: "21px",
  fontStyle: "italic",
  color: themeHex.foreground,
};

function BlockView({ block }: { block: EmailBlock }) {
  switch (block.type) {
    case "heading": {
      const level = HEADINGS[(block.level ?? 1) - 1] ?? HEADINGS[0];
      return (
        <Heading
          as={level.as}
          style={{
            margin: "0 0 22px",
            fontFamily: fonts.display,
            fontSize: level.size,
            fontWeight: 400,
            lineHeight: "1.18",
            color: themeHex.foreground,
          }}
        >
          {block.text}
        </Heading>
      );
    }
    case "paragraph":
      return <Text style={paragraph}>{block.text}</Text>;
    case "button":
      return (
        <Button href={block.url} style={button}>
          {block.label}
        </Button>
      );
    case "facts":
      return (
        <table style={{ width: "100%", margin: "0 0 22px", borderCollapse: "collapse" }}>
          <tbody>
            {block.rows.map((row, index) => (
              <tr key={index}>
                <th scope="row" style={factLabel}>
                  {row.label}
                </th>
                <td style={factValue}>{row.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    case "signature":
      return <Text style={signature}>{block.text ?? SIGNATURE}</Text>;
  }
}

function Blocks({ blocks }: { blocks: readonly EmailBlock[] }) {
  return (
    <>
      {blocks.map((block, index) => (
        <BlockView key={index} block={block} />
      ))}
    </>
  );
}

/** The default `Email` of a template file, and the shell a row with no template file is drawn in. */
export function Message({ title, preheader, blocks, site }: EmailProps) {
  return (
    <Layout title={title} preheader={preheader} site={site}>
      <Blocks blocks={blocks} />
    </Layout>
  );
}
