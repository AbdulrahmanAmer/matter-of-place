import { cx, ink, MEASURE, reading, sans, serif, textLink } from "../email/style.ts";

// The property block of a newsletter and of the standalone email, hung on Afternoon's axis like a framed print with
// its label: the photograph at the letter's measure, the title, one line, and the way to the home. A table with inline
// styles in the faces and colours of the email houses (`src/templates/email/style.ts`).

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
      align="center"
      style={{ width: "100%", margin: "0 0 8px", borderCollapse: "collapse" }}
    >
      <tbody>
        <tr>
          <td align="center">
            {/* Outlook ignores a CSS width, so the attribute holds the picture to the letter's measure; `width: 100%`
                lets every other client scale it with the column. */}
            <img
              src={props.image_url}
              alt={props.alt ?? props.title}
              width={MEASURE}
              loading="lazy"
              style={{
                display: "block",
                width: "100%",
                height: "auto",
                border: 0,
                backgroundColor: ink.sandstone,
                color: ink.mineral,
              }}
            />
          </td>
        </tr>
        <tr>
          <td
            align="center"
            className={cx(serif.className, "mop-t-state", "mop-ink")}
            style={{
              fontFamily: serif.fontFamily,
              fontSize: "30px",
              fontWeight: 300,
              lineHeight: "36px",
              color: ink.obsidian,
              textAlign: "center",
              padding: "26px 0 10px",
            }}
          >
            {props.title}
          </td>
        </tr>
        <tr>
          <td
            align="center"
            className={cx(serif.className, "mop-t-read", "mop-ink2")}
            style={{
              ...reading,
              fontSize: "19px",
              lineHeight: "30px",
              margin: 0,
              color: ink.mineral,
              textAlign: "center",
              padding: "0 0 20px",
            }}
          >
            {props.deck}
          </td>
        </tr>
        <tr>
          <td align="center" style={{ textAlign: "center" }}>
            <a
              href={props.link}
              className={cx(sans.className, "mop-ink")}
              style={textLink(ink.obsidian, ink.sandstone)}
            >
              View the home
            </a>
          </td>
        </tr>
      </tbody>
    </table>
  );
}
