import { cx, ink, reading, serif } from "../style.ts";

const centred = {
  ...reading,
  fontSize: "19px",
  lineHeight: "30px",
  margin: "0 auto 18px",
  maxWidth: "440px",
  color: ink.mineral,
  textAlign: "center",
} as const;

/** A line or two a person wrote: one paragraph for each line of the text, set on Afternoon's axis as the letter is. */
export function Intro({ text }: { text: string }) {
  return (
    <>
      {text
        .split(/\n+/)
        .filter((line) => line.trim() !== "")
        .map((line, index) => (
          <p key={index} className={cx(serif.className, "mop-t-read", "mop-ink2")} style={centred}>
            {line}
          </p>
        ))}
    </>
  );
}
