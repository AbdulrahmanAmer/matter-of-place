import { Text } from "@react-email/components";
import type { CSSProperties } from "react";
import { themeHex } from "../../theme.gen.ts";
import { fonts } from "../layout.tsx";

const paragraph: CSSProperties = {
  margin: "0 0 16px",
  fontFamily: fonts.body,
  fontSize: "15px",
  lineHeight: "1.7",
  color: themeHex.foreground,
};

/** A line or two a person wrote: one paragraph for each line of the text. */
export function Intro({ text }: { text: string }) {
  return (
    <>
      {text
        .split(/\n+/)
        .filter((line) => line.trim() !== "")
        .map((line, index) => (
          <Text key={index} style={paragraph}>
            {line}
          </Text>
        ))}
    </>
  );
}
