import { Button } from "@react-email/components";
import type { CSSProperties, ReactNode } from "react";
import type { EmailBlock } from "../../domain/email.ts";
import {
  cx,
  hairline,
  ink,
  label,
  lightTitle,
  NARROW,
  on,
  reading,
  sans,
  serif,
  shotTitle,
  statement,
  value,
  type Tone,
} from "./style.ts";

// The block model of architecture 3.5, drawn by every house. Every string arrives interpolated, so a block only draws;
// it reads no variable and drops nothing (`renderTemplate` dropped the empty blocks). A row reads the same way in each
// house: its leading level-1 headings are the opening (Threshold passes them through the door, Afternoon sets them as a
// placard, the light house as a title), a level-2 heading is a statement that starts a new part (in Threshold, a new
// shot on the other paper), a level-3 heading is a label, and a level-3 heading right before a level-2 one is that
// statement's label.

/** What a signature block says when its row gives no text: the plain-text part closes with it. */
export const SIGNATURE = "Matter of Place";

/** Which of the three houses draws a block: they share the blocks, not the measure or the alignment. */
type House = "threshold" | "afternoon" | "light";

const table = { role: "presentation", cellPadding: 0, cellSpacing: 0, border: 0 } as const;

type Heading = Extract<EmailBlock, { type: "heading" }>;

const levelOf = (block: Heading): number => block.level ?? 1;

/**
 * The opening of a row: its leading level-1 headings, at most two (the line that enters and the line that leaves),
 * and every block after them.
 */
export function opening(blocks: readonly EmailBlock[]): {
  lines: string[];
  rest: EmailBlock[];
} {
  const lines: string[] = [];
  let at = 0;
  for (const block of blocks) {
    if (lines.length === 2 || block.type !== "heading" || levelOf(block) !== 1) break;
    lines.push(block.text);
    at += 1;
  }
  return { lines, rest: blocks.slice(at) };
}

/**
 * The blocks after the opening, cut where a statement or a label starts a part. The first part holds what comes before
 * any of them and may be empty; a label directly followed by a statement starts that statement's part.
 */
export function sections(blocks: readonly EmailBlock[]): EmailBlock[][] {
  const parts: EmailBlock[][] = [[]];
  blocks.forEach((block, index) => {
    const previous = blocks[index - 1];
    const kicker = previous?.type === "heading" && levelOf(previous) === 3;
    const starts = block.type === "heading" && !(kicker && levelOf(block) === 2);
    if (starts && (parts.at(-1)?.length ?? 0) > 0) parts.push([]);
    parts.at(-1)?.push(block);
  });
  return parts;
}

/**
 * The film gives a title one italic word, the one that carries it. A heading that ends a sentence on a lower-case word
 * sets that word in italic ("is with the *editors.*"); one that ends on a name, a number or no full stop is left in
 * roman, since the word that carries it cannot be told there.
 */
export function emphasised(text: string): ReactNode {
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
function Spaced({
  padding,
  align,
  children,
}: {
  padding: string;
  align?: "left" | "center" | undefined;
  children: ReactNode;
}) {
  return (
    <table {...table} width="100%">
      <tbody>
        <tr>
          <td align={align} style={{ padding, textAlign: align ?? "left" }}>
            {children}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

/** The class that turns a part's ink to Bone when Apple Mail's night falls on a light paper. */
const night = (tone: Tone, quiet = false): string | undefined =>
  tone === "light" ? (quiet ? "mop-ink2" : "mop-ink") : undefined;

const centred = (house: House): "center" | "left" => (house === "afternoon" ? "center" : "left");

function LabelView({ text, house, tone }: { text: string; house: House; tone: Tone }) {
  return (
    <p
      className={cx(sans.className, night(tone, true))}
      style={{
        ...label,
        margin: "0 0 18px",
        color: on[tone].quiet,
        textAlign: centred(house),
      }}
    >
      {text}
    </p>
  );
}

/** A statement: the large line of a later part, with a short hairline under it in Threshold. */
function StatementView({ text, house, tone }: { text: string; house: House; tone: Tone }) {
  const set: Record<House, { style: CSSProperties; className: string }> = {
    threshold: { style: shotTitle, className: "mop-t-shot" },
    // Two even lines on the axis where the client balances them (Apple Mail), never one word left alone.
    afternoon: {
      style: { ...statement, maxWidth: "470px", textWrap: "balance" },
      className: "mop-t-state",
    },
    light: { style: { ...lightTitle, fontSize: "26px", lineHeight: "32px" }, className: "" },
  };
  const { style, className } = set[house];
  return (
    <>
      <p
        className={cx(serif.className, className, night(tone))}
        style={{
          ...style,
          margin: { threshold: "0", afternoon: "0 auto 22px", light: "0 0 22px" }[house],
          color: on[tone].text,
          textAlign: centred(house),
        }}
      >
        {emphasised(text)}
      </p>
      {house === "threshold" ? (
        <Spaced padding="30px 0 26px">
          <table {...table}>
            <tbody>
              <tr>
                <td
                  className={cx("mop-w", tone === "light" && "mop-hair")}
                  width={40}
                  style={{ ...hairline(ink.sandstone), width: "40px" }}
                >
                  &nbsp;
                </td>
              </tr>
            </tbody>
          </table>
        </Spaced>
      ) : null}
    </>
  );
}

function ParagraphView({ text, house, tone }: { text: string; house: House; tone: Tone }) {
  const size: Record<House, CSSProperties> = {
    threshold: {},
    afternoon: { fontSize: "19px", lineHeight: "30px", margin: "0 auto 18px", maxWidth: "440px" },
    light: { fontSize: "18px", lineHeight: "28px" },
  };
  return (
    <p
      className={cx(serif.className, "mop-t-read", night(tone, true))}
      style={{ ...reading, ...size[house], color: on[tone].quiet, textAlign: centred(house) }}
    >
      {lines(text)}
    </p>
  );
}

/** A button: a solid block in Threshold and the light house, a ruled one on Afternoon's wall. Never a pill. */
function ButtonView({
  label: text,
  url,
  house,
  tone,
}: {
  label: string;
  url: string;
  house: House;
  tone: Tone;
}) {
  const fill = tone === "dark" ? ink.bone : ink.obsidian;
  const word = tone === "dark" ? ink.obsidian : ink.bone;
  const ruled = house === "afternoon";
  return (
    <Spaced padding="12px 0 30px" align={centred(house)}>
      <table {...table} align={ruled ? "center" : undefined}>
        <tbody>
          <tr>
            <td
              className={tone === "light" ? "mop-btn" : undefined}
              style={
                ruled
                  ? { border: `1px solid ${ink.obsidian}` }
                  : { backgroundColor: fill, border: `1px solid ${fill}` }
              }
            >
              <Button
                href={url}
                className={sans.className}
                style={{
                  padding: house === "light" ? "14px 24px" : "17px 30px",
                  color: ruled ? ink.obsidian : word,
                  fontFamily: sans.fontFamily,
                  fontSize: "11px",
                  fontWeight: 500,
                  letterSpacing: "0.26em",
                  textTransform: "uppercase",
                  textDecoration: "none",
                }}
              >
                {text}
              </Button>
            </td>
          </tr>
        </tbody>
      </table>
    </Spaced>
  );
}

type Facts = Extract<EmailBlock, { type: "facts" }>["rows"];

const factLabel = (tone: Tone): CSSProperties => ({
  ...label,
  fontSize: "9.5px",
  letterSpacing: "0.28em",
  color: on[tone].quiet,
});

/** The widths of side-by-side facts: a name, a longer value such as an address, a short one. */
const COLUMNS: Record<number, readonly string[]> = {
  1: ["100%"],
  2: ["40%", "60%"],
  3: ["27%", "41%", "32%"],
};

/** Up to three facts in Threshold stand side by side under a hairline, as a record; a phone stacks them. */
function FactColumns({ rows, tone }: { rows: Facts; tone: Tone }) {
  const widths = COLUMNS[rows.length] ?? [];
  return (
    <Spaced padding="10px 0 34px">
      <table {...table} width="100%">
        <tbody>
          <tr>
            <td
              colSpan={rows.length}
              className={tone === "light" ? "mop-hair" : undefined}
              style={hairline(on[tone].rule)}
            >
              &nbsp;
            </td>
          </tr>
          <tr>
            {rows.map((row, index) => (
              <td
                key={index}
                className="mop-cell"
                valign="top"
                width={widths[index]}
                style={{
                  width: widths[index],
                  padding: index === rows.length - 1 ? "20px 0 0" : "20px 16px 0 0",
                  verticalAlign: "top",
                  textAlign: "left",
                }}
              >
                <p
                  className={cx(sans.className, night(tone, true))}
                  style={{ ...factLabel(tone), margin: "0 0 8px" }}
                >
                  {row.label}
                </p>
                <p
                  className={cx(serif.className, night(tone))}
                  style={{ ...value, color: on[tone].text }}
                >
                  {lines(row.value)}
                </p>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </Spaced>
  );
}

/**
 * Facts as ruled rows: a label and its value on one line. Afternoon centres a narrow schedule with the value set right;
 * Threshold and the light house run it across the measure. A data table, so it carries row headers, not a role.
 */
function FactRows({ rows, house, tone }: { rows: Facts; house: House; tone: Tone }) {
  const narrow = house === "afternoon";
  const rule = `1px solid ${on[tone].rule}`;
  const valueStyle: CSSProperties =
    house === "light"
      ? {
          fontFamily: sans.fontFamily,
          fontSize: "14px",
          lineHeight: "21px",
          color: on[tone].text,
        }
      : { ...value, fontSize: "18px", lineHeight: "24px", color: on[tone].text };
  return (
    <Spaced padding={narrow ? "8px 0 30px" : "6px 0 30px"} align={centred(house)}>
      <table
        cellPadding={0}
        cellSpacing={0}
        border={0}
        align={narrow ? "center" : undefined}
        width={narrow ? NARROW : "100%"}
        className={narrow ? "mop-narrow" : undefined}
        style={{
          width: narrow ? `${String(NARROW)}px` : "100%",
          borderCollapse: "collapse",
          margin: narrow ? "0 auto" : undefined,
        }}
      >
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              <th
                scope="row"
                className={cx(sans.className, "mop-ruled", night(tone, true))}
                style={{
                  ...factLabel(tone),
                  borderTop: rule,
                  borderBottom: index === rows.length - 1 ? rule : undefined,
                  width: narrow ? undefined : "38%",
                  padding: "14px 16px 13px 0",
                  textAlign: "left",
                  verticalAlign: "top",
                  lineHeight: "20px",
                }}
              >
                {row.label}
              </th>
              <td
                className={cx(
                  house === "light" ? sans.className : serif.className,
                  "mop-ruled",
                  night(tone),
                )}
                style={{
                  ...valueStyle,
                  borderTop: rule,
                  borderBottom: index === rows.length - 1 ? rule : undefined,
                  padding: "11px 0 11px",
                  textAlign: narrow ? "right" : "left",
                  verticalAlign: "top",
                }}
              >
                {lines(row.value)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Spaced>
  );
}

function SignatureView({ text, house, tone }: { text: string; house: House; tone: Tone }) {
  return (
    <p
      className={cx(serif.className, "mop-t-read", night(tone))}
      style={{
        ...reading,
        margin: "26px 0 0",
        fontStyle: "italic",
        color: on[tone].text,
        textAlign: centred(house),
      }}
    >
      {text}
    </p>
  );
}

function BlockView({ block, house, tone }: { block: EmailBlock; house: House; tone: Tone }) {
  switch (block.type) {
    case "heading":
      return levelOf(block) === 3 ? (
        <LabelView text={block.text} house={house} tone={tone} />
      ) : (
        <StatementView text={block.text} house={house} tone={tone} />
      );
    case "paragraph":
      return <ParagraphView text={block.text} house={house} tone={tone} />;
    case "button":
      return <ButtonView label={block.label} url={block.url} house={house} tone={tone} />;
    case "facts":
      return house === "threshold" && block.rows.length <= 3 ? (
        <FactColumns rows={block.rows} tone={tone} />
      ) : (
        <FactRows rows={block.rows} house={house} tone={tone} />
      );
    case "signature":
      // The house signs in its colophon, so the default signature draws nothing; the plain-text part still closes with
      // it. A signature the row words, a person's name, is set as the letter's last line.
      return block.text === undefined ? null : (
        <SignatureView text={block.text} house={house} tone={tone} />
      );
  }
}

/** A run of the row's blocks in reading order, drawn by `house` on paper of `tone`. */
export function Blocks({
  blocks,
  house,
  tone = "light",
}: {
  blocks: readonly EmailBlock[];
  house: House;
  tone?: Tone;
}) {
  return (
    <>
      {blocks.map((block, index) => (
        <BlockView key={index} block={block} house={house} tone={tone} />
      ))}
    </>
  );
}
