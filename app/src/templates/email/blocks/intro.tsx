import { cx, reading, serif } from "../style.ts";

/** A line or two a person wrote: one paragraph for each line of the text, set as the letter is. */
export function Intro({ text }: { text: string }) {
  return (
    <>
      {text
        .split(/\n+/)
        .filter((line) => line.trim() !== "")
        .map((line, index) => (
          <p key={index} className={cx(serif.className, "mop-reading")} style={reading}>
            {line}
          </p>
        ))}
    </>
  );
}
