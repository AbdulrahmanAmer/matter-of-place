import { Heading, Link, Text } from "@react-email/components";
import type { CSSProperties } from "react";
import { themeHex } from "../../theme.gen.ts";
import { fonts } from "../layout.tsx";
import { Intro } from "./intro.tsx";

const title: CSSProperties = {
  margin: "0 0 10px",
  fontFamily: fonts.display,
  fontSize: "28px",
  fontWeight: 400,
  lineHeight: "1.2",
  color: themeHex.foreground,
};

const deck: CSSProperties = {
  margin: "0 0 14px",
  fontFamily: fonts.body,
  fontSize: "15px",
  lineHeight: "1.6",
  color: themeHex.mutedForeground,
};

const read: CSSProperties = {
  fontFamily: fonts.body,
  fontSize: "12px",
  letterSpacing: "0.18em",
  textTransform: "uppercase",
  color: themeHex.foreground,
  textDecoration: "underline",
};

/** A story of the issue: what a person wrote above it, its title and deck, and the way to the story. */
export function Story({
  title: heading,
  deck: summary,
  text,
  href,
}: {
  title: string;
  deck: string;
  text: string | undefined;
  href: string;
}) {
  return (
    <>
      {text === undefined ? null : <Intro text={text} />}
      <Heading as="h2" style={title}>
        {heading}
      </Heading>
      {summary === "" ? null : <Text style={deck}>{summary}</Text>}
      <Link href={href} style={read}>
        Read the story
      </Link>
    </>
  );
}
