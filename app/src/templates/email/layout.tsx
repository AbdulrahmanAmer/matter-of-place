import { Body, Head, Html, Img, Preview } from "@react-email/components";
import type { CSSProperties, ReactNode } from "react";
import type { emailClasses, EmailBlock, EmailTemplateKey } from "../../domain/email.ts";
import type { SiteContext } from "../../server/email/context.ts";
import { themeHex } from "../theme.gen.ts";
import { Rule } from "./blocks/rule.tsx";
import { COLUMN, cx, fine, headStyles, label, MARGIN, sans, serif, small } from "./style.ts";

// The shell of every email (operator, 2026-10-15, after the 2026-10-12 shell: "properly remake all the designs we have
// for the emails ... using the quality of the motion graphic materials"). It is set the way the Product Launch film
// sets a page: a running header with the brand's lockup at the left, one short label at the right and a hairline
// under both; the letter on Warm Ivory with wide margins; and an Obsidian band that closes it with the line, the three
// markets and the legal lines, in words only. The brand is pictured once, in the header, and it is the only picture
// the shell has: with pictures off the email still opens on words, the wordmark's alt text standing in for it. Colours
// come from `theme.gen.ts`, never typed here; faces, sizes and motion from `style.ts`.

const PRODUCT_LINE = "Exceptional property. Properly considered.";
const MARKETS_LINE = "California · New York · Florida";
// The brand's horizontal lockup at the header's size, drawn by `scripts/email-art.mjs` at three times these numbers.
// The wordmark's strip is taller than its letters so its alt text has the room of a line.
const EMBLEM = { path: "/email/lockup-emblem.png", width: 23, height: 28 } as const;
const WORDMARK = { path: "/email/lockup-wordmark.png", width: 150, height: 16 } as const;

/**
 * What a template component receives: text and links already interpolated, empty blocks already dropped, and the
 * variables as the caller gave them, so a file that draws its own content (an object such as `block`) can read them.
 */
export interface EmailProps {
  title: string;
  preheader: string;
  blocks: readonly EmailBlock[];
  site: SiteContext;
  variables: Readonly<Record<string, unknown>>;
}

/**
 * The lines of the plain-text part that a template file draws itself, as it draws its own content in the HTML:
 * `lead` goes before the blocks, `trail` after the legal lines.
 */
export interface TextParts {
  lead: string[];
  trail: string[];
}

/** One template file's seed and metadata; the stored row is what is sent (invariant 1). */
export interface EmailDefinition {
  key: EmailTemplateKey;
  class: (typeof emailClasses)[number];
  subject: string;
  preheader: string;
  variables: readonly string[];
  blocks: EmailBlock[];
}

const table = { role: "presentation", cellPadding: 0, cellSpacing: 0, border: 0 } as const;

// The column is 600 px by its `width` attribute alone, the one width Outlook for Windows reads; a phone's media query
// (`.mop-column` in `style.ts`) makes it the width of the screen. A CSS `max-width` would not do it: a browser does not
// shrink a table of fixed width to it (measured 2026-10-15 in Edge at a 390 px viewport: scrollWidth 604).
const column: CSSProperties = { backgroundColor: themeHex.background };

const cell = (padding: string): CSSProperties => ({
  padding,
  textAlign: "left",
  verticalAlign: "top",
});

// With pictures off the wordmark's place shows its alt text, set as a label so the header still names the house.
const wordmarkAlt: CSSProperties = {
  display: "block",
  border: 0,
  fontFamily: sans.fontFamily,
  fontSize: "10px",
  lineHeight: "16px",
  letterSpacing: "0.22em",
  textTransform: "uppercase",
  color: themeHex.foreground,
};

const lineOnDark: CSSProperties = {
  margin: 0,
  fontFamily: serif.fontFamily,
  fontSize: "21px",
  fontWeight: 400,
  lineHeight: "1.3",
  color: themeHex.secondary,
};

/** The closing lines of every email, in the HTML footer and at the end of the plain-text part. */
export const footerLines = (site: SiteContext): string[] =>
  [PRODUCT_LINE, site.entity, site.address].filter((line) => line !== null);

/** The running header: the lockup at the left, the label at the right, a hairline that draws under both. */
function Header({ siteUrl, label: text }: { siteUrl: string; label: string | undefined }) {
  return (
    <>
      <tr>
        <td className="mop-pad" style={cell(`36px ${String(MARGIN)}px 0`)}>
          <table {...table} width="100%">
            <tbody>
              <tr>
                <td style={{ width: `${String(EMBLEM.width)}px`, verticalAlign: "middle" }}>
                  {/* `loading` keeps React 19 from adding a preload link for the first picture to the head (G-500). */}
                  <Img
                    className="mop-door"
                    src={`${siteUrl}${EMBLEM.path}`}
                    alt=""
                    width={EMBLEM.width}
                    height={EMBLEM.height}
                    loading="lazy"
                    style={{ display: "block", border: 0 }}
                  />
                </td>
                <td style={{ width: `${String(EMBLEM.width)}px` }} />
                <td style={{ verticalAlign: "middle" }}>
                  <Img
                    className={cx(sans.className, "mop-mark")}
                    src={`${siteUrl}${WORDMARK.path}`}
                    alt="Matter of Place"
                    width={WORDMARK.width}
                    height={WORDMARK.height}
                    loading="lazy"
                    style={wordmarkAlt}
                  />
                </td>
                {text === undefined ? null : (
                  <td
                    align="right"
                    className={cx(sans.className, "mop-label", "mop-wide")}
                    style={{
                      ...label,
                      paddingLeft: "16px",
                      textAlign: "right",
                      verticalAlign: "middle",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {text}
                  </td>
                )}
              </tr>
            </tbody>
          </table>
        </td>
      </tr>
      <tr>
        <td className="mop-pad" style={cell(`22px ${String(MARGIN)}px 0`)}>
          <Rule padding="0" className="mop-rule" />
        </td>
      </tr>
    </>
  );
}

/** The Obsidian band: the line with its one italic word, the markets, then the legal lines and what comes after. */
function Footer({ site, afterFooter }: { site: SiteContext; afterFooter: ReactNode }) {
  const [, ...legalLines] = footerLines(site);
  const [opening, closing] = PRODUCT_LINE.split(/ (?=considered)/);
  return (
    <tr>
      <td
        className="mop-pad"
        style={{
          ...cell(`46px ${String(MARGIN)}px 48px`),
          backgroundColor: themeHex.foreground,
        }}
      >
        <p className={serif.className} style={lineOnDark}>
          {opening} <em style={{ fontStyle: "italic" }}>{closing}</em>
        </p>
        <p
          className={sans.className}
          style={{ ...label, margin: "14px 0 0", color: themeHex.accent }}
        >
          {MARKETS_LINE}
        </p>
        {legalLines.length === 0 && afterFooter === null ? null : (
          <Rule padding="30px 0 22px" color={themeHex.mutedForeground} />
        )}
        {legalLines.map((text) => (
          <p key={text} className={small.className} style={fine}>
            {text}
          </p>
        ))}
        {afterFooter}
      </td>
    </tr>
  );
}

export function Layout({
  title,
  preheader,
  site,
  label: text,
  children,
  afterFooter = null,
}: Pick<EmailProps, "title" | "preheader" | "site"> & {
  /** The running header's label: what this email is, in two or three words. */
  label?: string | undefined;
  children: ReactNode;
  /** Drawn below the legal lines, on the dark band: the unsubscribe link of a commercial email. */
  afterFooter?: ReactNode;
}) {
  return (
    <Html lang="en">
      <Head>
        <title>{title}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light" />
        <meta name="supported-color-schemes" content="light" />
        <meta
          name="format-detection"
          content="telephone=no, date=no, address=no, email=no, url=no"
        />
        {/* React writes a style element's text as it is (measured 2026-10-15: quotes and `>` stay verbatim), so the
            CSS needs no raw HTML (R44). */}
        {headStyles(site.siteUrl).map((css) => (
          <style key={css.slice(0, 32)}>{css}</style>
        ))}
      </Head>
      <Body style={{ margin: 0, padding: 0, backgroundColor: themeHex.secondary }}>
        {preheader === "" ? null : <Preview>{preheader}</Preview>}
        <table
          {...table}
          width="100%"
          style={{ maxWidth: `${String(COLUMN)}px`, margin: "0 auto" }}
          align="center"
        >
          <tbody>
            <tr>
              <td className="mop-page" align="center" style={{ padding: "36px 0 48px" }}>
                <table
                  {...table}
                  width={COLUMN}
                  align="center"
                  className="mop-column"
                  style={column}
                >
                  <tbody>
                    <Header siteUrl={site.siteUrl} label={text} />
                    <tr>
                      <td className="mop-pad" style={cell(`46px ${String(MARGIN)}px 54px`)}>
                        {children}
                      </td>
                    </tr>
                    <Footer site={site} afterFooter={afterFooter} />
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>
      </Body>
    </Html>
  );
}
