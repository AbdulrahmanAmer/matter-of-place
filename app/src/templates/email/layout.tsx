import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Img,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import type { CSSProperties, ReactNode } from "react";
import type { emailClasses, EmailBlock, EmailTemplateKey } from "../../domain/email.ts";
import type { SiteContext } from "../../server/email/context.ts";
import { themeHex } from "../theme.gen.ts";

// The shell of every email (operator, 2026-10-12: "a massive design that shows the high level of who we are"): the
// Obsidian masthead with the stacked lockup, the letter on Ivory with wide margins, an ornament, and an Obsidian
// footer band with the emblem, the line, the three markets and the legal lines. The artwork is drawn as SVG by
// `scripts/email-art.mjs` and shown as PNG from our own domain, since mail clients strip inline SVG. Colours come from
// `theme.gen.ts`, never typed here. Mail clients load no web fonts, so each stack names the brand face first and a
// system face the client does have.

export const fonts = {
  display: '"Cormorant Garamond", Georgia, "Times New Roman", serif',
  body: 'Jost, "Helvetica Neue", Helvetica, Arial, sans-serif',
} as const;

const PRODUCT_LINE = "Exceptional property. Properly considered.";
const MARKETS_LINE = "California · New York · Florida";
const MASTHEAD = { path: "/email/masthead.png", width: 600, height: 240 } as const;
const ORNAMENT = { path: "/email/ornament.png", width: 600, height: 32 } as const;
const EMBLEM = { path: "/email/emblem.png", width: 48, height: 54 } as const;

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

const page: CSSProperties = {
  margin: 0,
  padding: "40px 12px",
  backgroundColor: themeHex.secondary,
  fontFamily: fonts.body,
  color: themeHex.foreground,
};

const column: CSSProperties = {
  maxWidth: "600px",
  margin: "0 auto",
  backgroundColor: themeHex.background,
};

const image: CSSProperties = { display: "block", width: "100%", height: "auto", border: 0 };

const letter: CSSProperties = {
  padding: "52px 52px 20px",
  backgroundColor: themeHex.background,
};

const band: CSSProperties = {
  padding: "44px 40px 40px",
  backgroundColor: themeHex.foreground,
  textAlign: "center",
};

const line: CSSProperties = {
  margin: "20px 0 0",
  fontFamily: fonts.display,
  fontSize: "21px",
  fontStyle: "italic",
  lineHeight: "1.3",
  color: themeHex.secondary,
};

const markets: CSSProperties = {
  margin: "14px 0 0",
  fontFamily: fonts.body,
  fontSize: "10px",
  letterSpacing: "0.32em",
  textTransform: "uppercase",
  color: themeHex.accent,
};

const hairline: CSSProperties = {
  margin: "28px auto 22px",
  width: "48px",
  border: 0,
  borderTop: `1px solid ${themeHex.mutedForeground}`,
};

const legal: CSSProperties = {
  margin: 0,
  fontFamily: fonts.body,
  fontSize: "11px",
  letterSpacing: "0.04em",
  lineHeight: "1.8",
  color: themeHex.accent,
};

/** The closing lines of every email, in the HTML footer and at the end of the plain-text part. */
export const footerLines = (site: SiteContext): string[] =>
  [PRODUCT_LINE, site.entity, site.address].filter((line) => line !== null);

export function Layout({
  title,
  preheader,
  site,
  children,
  afterFooter = null,
}: Pick<EmailProps, "title" | "preheader" | "site"> & {
  children: ReactNode;
  /** Drawn below the legal lines, on the dark band: the unsubscribe link of a commercial email. */
  afterFooter?: ReactNode;
}) {
  const [, ...legalLines] = footerLines(site);
  return (
    <Html lang="en">
      <Head>
        <title>{title}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light" />
        <meta name="supported-color-schemes" content="light" />
      </Head>
      <Body style={page}>
        {preheader === "" ? null : <Preview>{preheader}</Preview>}
        <Container style={column}>
          {/* The masthead names the business, so its alt text says it. `loading` keeps React 19 from adding a preload link to the head (G-500). */}
          <Img
            src={`${site.siteUrl}${MASTHEAD.path}`}
            alt="Matter of Place"
            width={MASTHEAD.width}
            height={MASTHEAD.height}
            loading="lazy"
            style={image}
          />
          <Section style={letter}>{children}</Section>
          <Img
            src={`${site.siteUrl}${ORNAMENT.path}`}
            alt=""
            width={ORNAMENT.width}
            height={ORNAMENT.height}
            loading="lazy"
            style={image}
          />
          <Section style={{ ...letter, padding: "0 0 28px" }} />
          <Section style={band}>
            <Img
              src={`${site.siteUrl}${EMBLEM.path}`}
              alt=""
              width={EMBLEM.width}
              height={EMBLEM.height}
              loading="lazy"
              style={{ display: "block", margin: "0 auto", border: 0 }}
            />
            <Text style={line}>{PRODUCT_LINE}</Text>
            <Text style={markets}>{MARKETS_LINE}</Text>
            {legalLines.length === 0 && afterFooter === null ? null : <Hr style={hairline} />}
            {legalLines.map((text) => (
              <Text key={text} style={legal}>
                {text}
              </Text>
            ))}
            {afterFooter}
          </Section>
        </Container>
      </Body>
    </Html>
  );
}
