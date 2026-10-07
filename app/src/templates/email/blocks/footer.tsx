import { Link, Text } from "@react-email/components";
import type { CSSProperties } from "react";
import type { SiteContext } from "../../../server/email/context.ts";
import { themeHex } from "../../theme.gen.ts";
import { fonts, footerLines } from "../layout.tsx";

/** Resend replaces this variable with the recipient's own unsubscribe page when it sends a broadcast. */
export const UNSUBSCRIBE_URL = "{{{RESEND_UNSUBSCRIBE_URL}}}";

const line: CSSProperties = {
  margin: 0,
  fontFamily: fonts.body,
  fontSize: "12px",
  lineHeight: "1.7",
  color: themeHex.mutedForeground,
};

/** What commercial email must carry: the legal entity, the postal address and a working unsubscribe link. */
export function Footer({ site }: { site: SiteContext }) {
  return (
    <>
      {footerLines(site).map((text) => (
        <Text key={text} style={line}>
          {text}
        </Text>
      ))}
      <Text style={line}>
        <Link href={UNSUBSCRIBE_URL} style={{ color: themeHex.mutedForeground }}>
          Unsubscribe
        </Link>
      </Text>
    </>
  );
}
