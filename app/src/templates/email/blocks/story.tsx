import { cx, ink, reading, sans, serif, textLink } from "../style.ts";
import { Intro } from "./intro.tsx";

/** A story of the issue, on Afternoon's axis: what a person wrote above it, its title and deck, and the way to it. */
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
      <p
        className={cx(serif.className, "mop-t-state", "mop-ink")}
        style={{
          margin: "0 0 12px",
          fontFamily: serif.fontFamily,
          fontSize: "30px",
          fontWeight: 300,
          lineHeight: "36px",
          color: ink.obsidian,
          textAlign: "center",
        }}
      >
        {heading}
      </p>
      {summary === "" ? null : (
        <p
          className={cx(serif.className, "mop-t-read", "mop-ink2")}
          style={{
            ...reading,
            fontSize: "19px",
            lineHeight: "30px",
            margin: "0 auto 20px",
            maxWidth: "440px",
            color: ink.mineral,
            textAlign: "center",
          }}
        >
          {summary}
        </p>
      )}
      <a
        href={href}
        className={cx(sans.className, "mop-ink")}
        style={textLink(ink.obsidian, ink.sandstone)}
      >
        Read the story
      </a>
    </>
  );
}
