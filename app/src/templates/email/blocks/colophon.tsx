import type { SiteContext } from "../../../server/email/context.ts";
import { ART } from "../art.ts";
import { PRODUCT_LINE } from "../layout.tsx";
import { cx, fine, GUTTER, hairline, ink, small } from "../style.ts";
import { Unsubscribe } from "./footer.tsx";
import { Picture } from "./picture.tsx";

const table = { role: "presentation", cellPadding: 0, cellSpacing: 0, border: 0 } as const;

/**
 * The close of every email, the same words in all three houses: the wordmark, the brand line and the three markets,
 * the site, why this email came (`note`), the legal issuer and its postal address, and an unsubscribe link for a
 * commercial email. Bone, small, in Epilogue, the brand's face for footers. Threshold and the light house set it on
 * the left, Afternoon on its centre axis. A row of the house's 600 px column.
 */
export function Colophon({
  site,
  align,
  note,
  unsubscribe,
}: {
  site: SiteContext;
  align: "left" | "center";
  note?: string | undefined;
  unsubscribe?: string | undefined;
}) {
  const host = new URL(site.siteUrl).host;
  const legal = [site.entity, site.address].filter((line) => line !== null).join(", ");
  const smallPrint = [note ?? "", legal].filter((line) => line !== "");
  const quiet = { ...fine, color: ink.mineral, textAlign: align } as const;
  return (
    <tr>
      <td
        className="mop-px mop-paper"
        align={align}
        style={{
          padding: `48px ${String(GUTTER)}px 54px`,
          backgroundColor: ink.bone,
          textAlign: align,
        }}
      >
        <table {...table} align={align === "center" ? "center" : undefined}>
          <tbody>
            <tr>
              <td
                className="mop-hair"
                width={24}
                style={{ ...hairline(ink.sandstone), width: "24px" }}
              >
                &nbsp;
              </td>
            </tr>
          </tbody>
        </table>
        <table {...table} align={align === "center" ? "center" : undefined}>
          <tbody>
            <tr>
              <td style={{ padding: "26px 0 18px" }}>
                {/* Not a link: a link must have words (the email lint), and the site's address follows in words. */}
                <Picture
                  src={`${site.siteUrl}${ART.wordmark.path}`}
                  art={ART.wordmark}
                  alt="Matter of Place"
                  paper={ink.bone}
                  ink={ink.obsidian}
                  day
                />
                <Picture
                  src={`${site.siteUrl}${ART.wordmarkDark.path}`}
                  art={ART.wordmarkDark}
                  alt="Matter of Place"
                  paper={ink.obsidian}
                  ink={ink.bone}
                  night
                />
              </td>
            </tr>
          </tbody>
        </table>
        <p className={cx(small.className, "mop-ink2")} style={quiet}>
          {`${PRODUCT_LINE} California, New York and Florida.`}
        </p>
        <p className={small.className} style={{ ...quiet, margin: "4px 0 0" }}>
          <a
            href={site.siteUrl}
            className="mop-ink"
            style={{
              color: ink.obsidian,
              textDecoration: "none",
              borderBottom: `1px solid ${ink.sandstone}`,
            }}
          >
            {host}
          </a>
        </p>
        {smallPrint.length === 0 ? null : (
          <p
            className={cx(small.className, "mop-ink2")}
            style={{ ...quiet, margin: "22px 0 0", fontSize: "11px", lineHeight: "18px" }}
          >
            {smallPrint.map((line, index) => (
              <span key={line}>
                {index === 0 ? null : <br />}
                {line}
              </span>
            ))}
          </p>
        )}
        {unsubscribe === undefined ? null : <Unsubscribe href={unsubscribe} />}
      </td>
    </tr>
  );
}
