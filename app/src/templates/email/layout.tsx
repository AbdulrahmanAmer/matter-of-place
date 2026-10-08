import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Img,
  Preview,
  Row,
  Column,
  Text,
} from "@react-email/components";
import type { CSSProperties, ReactNode } from "react";
import type { emailClasses, EmailBlock, EmailTemplateKey } from "../../domain/email.ts";
import type { SiteContext } from "../../server/email/context.ts";
import { themeHex } from "../theme.gen.ts";

// The shell of every transactional email: emblem and wordmark, one 600 px column, a footer. Colours come from
// `theme.gen.ts` (the tokens), never typed here. Mail clients load no web fonts, so each stack names the brand face
// first and a system face the client does have.

export const fonts = {
  display: '"Cormorant Garamond", Georgia, "Times New Roman", serif',
  body: 'Jost, "Helvetica Neue", Helvetica, Arial, sans-serif',
} as const;

const PRODUCT_LINE = "Exceptional property. Properly considered.";
const EMBLEM_PATH = "/apple-touch-icon.png";
const EMBLEM_SIZE = 36;

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
  padding: "32px 12px",
  backgroundColor: themeHex.secondary,
  fontFamily: fonts.body,
  color: themeHex.foreground,
};

const column: CSSProperties = {
  maxWidth: "600px",
  margin: "0 auto",
  padding: "40px 32px",
  backgroundColor: themeHex.background,
};

const mark: CSSProperties = {
  margin: 0,
  fontFamily: fonts.body,
  fontSize: "12px",
  letterSpacing: "0.32em",
  textTransform: "uppercase",
  color: themeHex.foreground,
};

const rule: CSSProperties = {
  margin: "28px 0",
  border: 0,
  borderTop: `1px solid ${themeHex.accent}`,
};

const footer: CSSProperties = {
  margin: 0,
  fontFamily: fonts.body,
  fontSize: "12px",
  lineHeight: "1.7",
  color: themeHex.mutedForeground,
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
  /** Drawn below the legal lines: the unsubscribe link of a commercial email. */
  afterFooter?: ReactNode;
}) {
  return (
    <Html lang="en">
      <Head>
        <title>{title}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light" />
      </Head>
      <Body style={page}>
        {preheader === "" ? null : <Preview>{preheader}</Preview>}
        <Container style={column}>
          <Row>
            <Column style={{ width: EMBLEM_SIZE, verticalAlign: "middle" }}>
              {/* The text beside it names the business, so the emblem has no alt text. `loading` keeps React 19 from adding a preload link to the head. */}
              <Img
                src={`${site.siteUrl}${EMBLEM_PATH}`}
                alt=""
                width={EMBLEM_SIZE}
                height={EMBLEM_SIZE}
                loading="lazy"
                style={{ display: "block" }}
              />
            </Column>
            <Column style={{ paddingLeft: "16px", verticalAlign: "middle" }}>
              <Text style={mark}>Matter of Place</Text>
            </Column>
          </Row>
          <Hr style={rule} />
          {children}
          <Hr style={rule} />
          {footerLines(site).map((line) => (
            <Text key={line} style={footer}>
              {line}
            </Text>
          ))}
          {afterFooter}
        </Container>
      </Body>
    </Html>
  );
}
