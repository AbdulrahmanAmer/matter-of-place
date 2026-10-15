import { Button } from "@react-email/components";
import type { CSSProperties, ReactNode } from "react";
import type { EmailBlock } from "../../domain/email.ts";
import { themeHex } from "../theme.gen.ts";
import { Layout, type EmailProps } from "./layout.tsx";
import { cx, display, label, reading, sans, serif } from "./style.ts";

// The block model of architecture 3.5 as React Email components. Every string arrives interpolated, so a component
// only draws; it reads no variable and drops nothing (`renderTemplate` dropped the empty blocks). How each block is set
// follows `style.ts`: a display line in Cormorant, the letter in Cormorant at a reading size, labels and facts in Jost
// capitals, and a solid Obsidian button.

/** What a signature block says when its row gives no text: the plain-text part closes with it. */
export const SIGNATURE = "Matter of Place";

const table = { role: "presentation", cellPadding: 0, cellSpacing: 0, border: 0 } as const;

const HEADINGS = [
  { as: "h1", style: display, className: "mop-display" },
  { as: "h2", style: { ...display, fontSize: "30px", lineHeight: "1.15" }, className: "mop-title" },
  { as: "h3", style: { ...display, fontSize: "23px", lineHeight: "1.25" }, className: undefined },
] as const;

/**
 * The film gives a title one italic word, the one that carries it. A heading that ends a sentence on a lower-case word
 * sets that word in italic ("Your property has been *selected.*"); one that ends on a name, a number or no full stop is
 * left in roman, since the word that carries it cannot be told there.
 */
function emphasised(text: string): ReactNode {
  const match = /^(.*\s)(\p{Ll}\S*[.?])$/u.exec(text);
  if (match === null) return text;
  return (
    <>
      {match[1]}
      <em style={{ fontStyle: "italic" }}>{match[2]}</em>
    </>
  );
}

/** A paragraph's own line breaks (a list of payment methods) stay line breaks. */
function lines(text: string): ReactNode {
  return text.split("\n").map((line, index) => (
    <span key={index}>
      {index === 0 ? null : <br />}
      {line}
    </span>
  ));
}

/** Vertical space that Outlook keeps too: padding on a cell, where a margin would be dropped. */
function Spaced({ padding, children }: { padding: string; children: ReactNode }) {
  return (
    <table {...table} width="100%">
      <tbody>
        <tr>
          <td style={{ padding }}>{children}</td>
        </tr>
      </tbody>
    </table>
  );
}

const button: CSSProperties = {
  padding: "17px 30px",
  backgroundColor: themeHex.foreground,
  color: themeHex.secondary,
  fontFamily: sans.fontFamily,
  fontSize: "11px",
  fontWeight: 500,
  letterSpacing: "0.26em",
  textTransform: "uppercase",
  textDecoration: "none",
};

const factCell = (last: boolean): CSSProperties => ({
  borderTop: `1px solid ${themeHex.accent}`,
  ...(last ? { borderBottom: `1px solid ${themeHex.accent}` } : {}),
  textAlign: "left",
  verticalAlign: "top",
});

/** The display line that opens a letter rises into its mask; any later heading stands still. */
function HeadingView({
  block,
  first,
}: {
  block: Extract<EmailBlock, { type: "heading" }>;
  first: boolean;
}) {
  const level = HEADINGS[(block.level ?? 1) - 1] ?? HEADINGS[0];
  const Tag = level.as;
  const heading = (
    <Tag
      className={cx(serif.className, level.className, first && "mop-rise")}
      style={{ ...level.style, margin: 0 }}
    >
      {emphasised(block.text)}
    </Tag>
  );
  // The mask is a little taller than the line, so a descender of the italic is never cut.
  return (
    <div
      style={{ overflow: "hidden", padding: "0 0 6px", margin: first ? "0 0 22px" : "12px 0 16px" }}
    >
      {heading}
    </div>
  );
}

function BlockView({ block, first }: { block: EmailBlock; first: boolean }) {
  switch (block.type) {
    case "heading":
      return <HeadingView block={block} first={first} />;
    case "paragraph":
      return (
        <p className={cx(serif.className, "mop-reading")} style={reading}>
          {lines(block.text)}
        </p>
      );
    case "button":
      return (
        <Spaced padding="10px 0 28px">
          <table {...table}>
            <tbody>
              <tr>
                <td style={{ backgroundColor: themeHex.foreground }}>
                  <Button href={block.url} className={sans.className} style={button}>
                    {block.label}
                  </Button>
                </td>
              </tr>
            </tbody>
          </table>
        </Spaced>
      );
    case "facts":
      return (
        <Spaced padding="8px 0 30px">
          <table
            {...table}
            role={undefined}
            width="100%"
            style={{ width: "100%", borderCollapse: "collapse" }}
          >
            <tbody>
              {block.rows.map((row, index) => {
                const last = index === block.rows.length - 1;
                return (
                  <tr key={index}>
                    <th
                      scope="row"
                      className={sans.className}
                      style={{
                        ...label,
                        ...factCell(last),
                        width: "38%",
                        padding: "15px 16px 14px 0",
                      }}
                    >
                      {row.label}
                    </th>
                    <td
                      className={sans.className}
                      style={{
                        ...factCell(last),
                        padding: "12px 0 12px",
                        fontFamily: sans.fontFamily,
                        fontSize: "15px",
                        lineHeight: "1.5",
                        color: themeHex.foreground,
                      }}
                    >
                      {lines(row.value)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Spaced>
      );
    case "signature":
      // The house signs once, in the header (operator, 2026-10-15: the name under the paragraphs and again at the foot
      // read oddly), so the default signature draws nothing; the plain-text part still closes with it. A signature the
      // row words, a person's name, is set as the letter's last line.
      return block.text === undefined ? null : (
        <p
          className={cx(serif.className, "mop-reading")}
          style={{
            ...reading,
            margin: "26px 0 0",
            fontStyle: "italic",
            color: themeHex.foreground,
          }}
        >
          {block.text}
        </p>
      );
  }
}

/**
 * The row's blocks in order. An opening heading rises on its own; everything after it follows as one, so the letter
 * appears once the line is set.
 */
export function Blocks({ blocks }: { blocks: readonly EmailBlock[] }) {
  const [head, ...rest] = blocks;
  const opens = head?.type === "heading";
  const following = opens ? rest : blocks;
  return (
    <>
      {opens ? <BlockView block={head} first /> : null}
      <div className="mop-follow">
        {following.map((block, index) => (
          <BlockView key={index} block={block} first={false} />
        ))}
      </div>
    </>
  );
}

/** The default `Email` of a template file, and the shell a row with no template file is drawn in. */
export function Message({
  title,
  preheader,
  blocks,
  site,
  label: text,
}: EmailProps & { label?: string | undefined }) {
  return (
    <Layout title={title} preheader={preheader} site={site} label={text}>
      <Blocks blocks={blocks} />
    </Layout>
  );
}

/** The `Email` of a template file whose row only holds blocks: the shell with the running header's label. */
export const letter = (text: string) =>
  function Letter(props: EmailProps) {
    return <Message {...props} label={text} />;
  };
