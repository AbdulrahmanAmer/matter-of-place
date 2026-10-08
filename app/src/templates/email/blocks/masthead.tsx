import { Heading, Section, Text } from "@react-email/components";
import type { CSSProperties } from "react";
import { themeHex } from "../../theme.gen.ts";
import { fonts } from "../layout.tsx";

const mark: CSSProperties = {
  margin: 0,
  fontFamily: fonts.body,
  fontSize: "12px",
  letterSpacing: "0.32em",
  textTransform: "uppercase",
  color: themeHex.mutedForeground,
};

const title: CSSProperties = {
  margin: "14px 0 4px",
  fontFamily: fonts.display,
  fontSize: "44px",
  fontWeight: 400,
  lineHeight: "1.1",
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
