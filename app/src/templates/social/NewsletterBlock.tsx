import { cx, display, MEASURE, reading, sans, serif, textLink } from "../email/style.ts";
import { themeHex } from "../theme.gen.ts";

// The property block of a newsletter and of the standalone email: a table with inline styles, set in the faces and
// measures of the email shell (`src/templates/email/style.ts`). Colours come from `theme.gen.ts`.

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

export function NewsletterBlock(props: NewsletterBlockProps) {
  return (
    <table
      role="presentation"
      cellPadding={0}
      cellSpacing={0}
      style={{ width: "100%", margin: "0 0 8px", borderCollapse: "collapse" }}
    >
      <tbody>
        <tr>
          <td>
            {/* Outlook ignores a CSS width, so the attribute holds the picture to the letter's measure; `width: 100%`
                lets every other client scale it with the column. */}
            <img
              src={props.image_url}
              alt={props.alt ?? props.title}
              width={MEASURE}
              style={{
                display: "block",
                width: "100%",
                height: "auto",
                border: 0,
                backgroundColor: themeHex.secondary,
              }}
            />
          </td>
        </tr>
        <tr>
          <td
            className={cx(serif.className, "mop-title")}
            style={{ ...display, fontSize: "30px", lineHeight: "1.15", padding: "24px 0 10px" }}
          >
            {props.title}
          </td>
        </tr>
        <tr>
          <td
            className={cx(serif.className, "mop-reading")}
            style={{ ...reading, margin: 0, padding: "0 0 20px" }}
          >
            {props.deck}
          </td>
        </tr>
        <tr>
          <td>
            <a href={props.link} className={sans.className} style={textLink}>
              View the property
            </a>
          </td>
        </tr>
      </tbody>
    </table>
  );
}
