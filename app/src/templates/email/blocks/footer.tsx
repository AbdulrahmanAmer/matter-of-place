import { Link } from "@react-email/components";
import { themeHex } from "../../theme.gen.ts";
import { fine, small } from "../style.ts";

/** Resend replaces this variable with the recipient's own unsubscribe page when it sends a broadcast. */
export const UNSUBSCRIBE_URL = "{{{RESEND_UNSUBSCRIBE_URL}}}";

/**
 * The working unsubscribe link of commercial email, drawn below the legal lines that `Layout` prints, on its Obsidian
 * band. A broadcast keeps Resend's variable; a one-to-one email, which Resend does not fill, passes its own `href`.
 */
export function Unsubscribe({ href = UNSUBSCRIBE_URL }: { href?: string }) {
  return (
    <p className={small.className} style={{ ...fine, margin: "18px 0 0" }}>
      <Link href={href} style={{ color: themeHex.accent, textDecoration: "underline" }}>
        Unsubscribe
      </Link>
    </p>
  );
}
