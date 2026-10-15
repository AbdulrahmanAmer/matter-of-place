import { Body, Head, Html, Preview } from "@react-email/components";
import type { ReactNode } from "react";
import type { emailClasses, EmailBlock, EmailTemplateKey } from "../../domain/email.ts";
import type { SiteContext } from "../../server/email/context.ts";
import { headStyles } from "./style.ts";

// The document every email is drawn in, whatever its house (`house/*.tsx`): the head with the four style blocks of
// `style.ts`, the hidden preheader, and the page. Since the redesign of 2026-10-15 (the operator chose the directions
// Threshold and Afternoon, "based on the type of the email") the shell holds no picture and no words of its own: each
// house draws its door, its opening and the colophon they share.

/** The brand line that closes every email, in the colophon and at the end of the plain-text part. */
export const PRODUCT_LINE = "Exceptional property. Properly considered.";

/**
 * What a template component receives: text and links already interpolated, empty blocks already dropped, and the
 * variables as the caller gave them, so a file that draws its own content (an amount, an object such as `block`) can
 * read them.
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

/**
 * The closing lines of every email at the end of the plain-text part: the brand line, the site the colophon links to,
 * and the legal ones.
 */
export const footerLines = (site: SiteContext): string[] =>
  [PRODUCT_LINE, site.siteUrl, site.entity, site.address].filter((line) => line !== null);

/** A string variable as the template reads it; anything else (missing, an object) is empty. */
export const variable = (variables: EmailProps["variables"], name: string): string => {
  const given = variables[name];
  return typeof given === "string" ? given : "";
};

/** Where a home stands, as Threshold pins it under the door: its city and its state. */
export const cityState = (variables: EmailProps["variables"]): string =>
  [variable(variables, "city"), variable(variables, "state")]
    .filter((part) => part !== "")
    .join(" · ");

export function Shell({
  title,
  preheader,
  site,
  page,
  children,
}: Pick<EmailProps, "title" | "preheader" | "site"> & {
  /** The colour of the page around the column, which a client shows past its edges. */
  page: string;
  children: ReactNode;
}) {
  return (
    <Html lang="en">
      <Head>
        <title>{title}</title>
        {/* React Email's `Head` writes the charset and `x-apple-disable-message-reformatting` itself. */}
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light dark" />
        <meta name="supported-color-schemes" content="light dark" />
        <meta
          name="format-detection"
          content="telephone=no, date=no, address=no, email=no, url=no"
        />
        {/* React writes a style element's text as it is (measured 2026-10-15: quotes and `>` stay verbatim), so the
            CSS needs no raw HTML (R44). */}
        {headStyles(site.siteUrl).map((css) => (
          <style key={css.slice(0, 40)}>{css}</style>
        ))}
      </Head>
      <Body className="mop-paper" style={{ margin: 0, padding: 0, backgroundColor: page }}>
        {preheader === "" ? null : <Preview>{preheader}</Preview>}
        {children}
      </Body>
    </Html>
  );
}
