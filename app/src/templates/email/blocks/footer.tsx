import { Link } from "@react-email/components";
import { cx, fine, ink, small } from "../style.ts";

/** Resend replaces this variable with the recipient's own unsubscribe page when it sends a broadcast. */
export const UNSUBSCRIBE_URL = "{{{RESEND_UNSUBSCRIBE_URL}}}";

/**
 * The working unsubscribe link of commercial email, the last line of the colophon every house shares. A broadcast
 * passes Resend's variable (`UNSUBSCRIBE_URL`); a one-to-one email, which Resend does not fill, passes its own address.
 */
export function Unsubscribe({ href }: { href: string }) {
  return (
    <p
      className={cx(small.className, "mop-ink2")}
      style={{ ...fine, fontSize: "11px", margin: "14px 0 0", color: ink.mineral }}
    >
      <Link href={href} style={{ color: ink.mineral, textDecoration: "underline" }}>
        Unsubscribe
      </Link>
    </p>
  );
}
