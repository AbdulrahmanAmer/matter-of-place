import type { CSSProperties } from "react";
import { fonts } from "../email/layout.tsx";
import { themeHex } from "../theme.gen.ts";

// The property block of a newsletter and of the standalone email: a table with inline styles, because a mail client
// reads neither a stylesheet nor a web font. Colours come from `theme.gen.ts`.

/** The asset's `meta.block` as `build_newsletter_block` stored it, with the alt text a caller holding the asset adds. */
export interface NewsletterBlockProps {
  title: string;
  deck: string;
  image_key: string;
  /** An absolute https address a mail client can load; `image_key` is never turned into an address here. */
  image_url: string;
  link: string;
  alt?: string | undefined;
}

// The width of the layout's column (600 px less 32 px of padding each side): Outlook ignores a CSS width, so the
// attribute holds the image to the column, and `width: 100%` below lets every other client scale it.
const IMAGE_WIDTH = 536;

const table: CSSProperties = { width: "100%", margin: "0 0 22px", borderCollapse: "collapse" };

const image: CSSProperties = { display: "block", width: "100%", height: "auto", border: 0 };

const title: CSSProperties = {
  margin: 0,
  padding: "18px 0 8px",
  fontFamily: fonts.display,
  fontSize: "26px",
  fontWeight: 400,
  lineHeight: "1.18",
  color: themeHex.foreground,
};

const deck: CSSProperties = {
  margin: 0,
  padding: "0 0 14px",
  fontFamily: fonts.body,
  fontSize: "15px",
  lineHeight: "1.7",
  color: themeHex.mutedForeground,
};

const anchor: CSSProperties = {
  fontFamily: fonts.body,
  fontSize: "12px",
  letterSpacing: "0.18em",
  textTransform: "uppercase",
  textDecoration: "none",
  color: themeHex.foreground,
};

export function NewsletterBlock(props: NewsletterBlockProps) {
  return (
    <table role="presentation" cellPadding={0} cellSpacing={0} style={table}>
      <tbody>
        <tr>
          <td>
            <img
              src={props.image_url}
              alt={props.alt ?? props.title}
              width={IMAGE_WIDTH}
              style={image}
            />
          </td>
        </tr>
        <tr>
          <td style={title}>{props.title}</td>
        </tr>
        <tr>
          <td style={deck}>{props.deck}</td>
        </tr>
        <tr>
          <td style={{ borderTop: `1px solid ${themeHex.accent}`, padding: "14px 0 0" }}>
            <a href={props.link} style={anchor}>
              View the property
            </a>
          </td>
        </tr>
      </tbody>
    </table>
  );
}
