import { Link, Text } from "@react-email/components";
import type { CSSProperties } from "react";
import { themeHex } from "../../theme.gen.ts";
import { fonts } from "../layout.tsx";

/** Resend replaces this variable with the recipient's own unsubscribe page when it sends a broadcast. */
export const UNSUBSCRIBE_URL = "{{{RESEND_UNSUBSCRIBE_URL}}}";

// It sits on the Obsidian footer band of `Layout`, under the legal lines, in Sandstone.
const line: CSSProperties = {
  margin: "18px 0 0",
  fontFamily: fonts.body,
  fontSize: "11px",
  letterSpacing: "0.08em",
  lineHeight: "1.7",
  color: themeHex.accent,
};

/** The working unsubscribe link of commercial email, drawn below the legal lines that `Layout` prints. */
export function Unsubscribe() {
  return (
    <Text style={line}>
      <Link href={UNSUBSCRIBE_URL} style={{ color: themeHex.accent, textDecoration: "underline" }}>
        Unsubscribe
      </Link>
    </Text>
  );
}
