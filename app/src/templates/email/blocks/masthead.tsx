import { Heading, Section, Text } from "@react-email/components";
import type { CSSProperties } from "react";
import { themeHex } from "../../theme.gen.ts";
import { fonts } from "../layout.tsx";

const mark: CSSProperties = {
  margin: 0,
  fontFamily: fonts.body,
  fontSize: "11px",
  letterSpacing: "0.32em",
  textTransform: "uppercase",
  color: themeHex.mutedForeground,
};

const title: CSSProperties = {
  margin: "12px 0 6px",
  fontFamily: fonts.display,
  fontSize: "52px",
  fontWeight: 400,
  fontStyle: "italic",
  lineHeight: "1.05",
  color: themeHex.foreground,
};

const issueNumber: CSSProperties = {
  margin: 0,
  fontFamily: fonts.body,
  fontSize: "13px",
  letterSpacing: "0.18em",
  textTransform: "uppercase",
  color: themeHex.mutedForeground,
};

/** The head of an issue: the house name, the title and the number. */
export function Masthead({ number }: { number: number }) {
  return (
    <Section>
      <Text style={mark}>Matter of Place</Text>
      <Heading as="h1" style={title}>
        Place Notes
      </Heading>
      <Text style={issueNumber}>{`No. ${String(number)}`}</Text>
    </Section>
  );
}
