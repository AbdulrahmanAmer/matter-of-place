import { cx, display, reading, sans, serif, textLink } from "../style.ts";
import { Intro } from "./intro.tsx";

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
      <h2
        className={cx(serif.className, "mop-title")}
        style={{ ...display, fontSize: "30px", lineHeight: "1.15", margin: "0 0 12px" }}
      >
        {heading}
      </h2>
      {summary === "" ? null : (
        <p
          className={cx(serif.className, "mop-reading")}
          style={{ ...reading, margin: "0 0 20px" }}
        >
          {summary}
        </p>
      )}
      <a href={href} className={sans.className} style={textLink}>
        Read the story
      </a>
    </>
  );
}
