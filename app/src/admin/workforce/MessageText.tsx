import { Fragment, type ReactNode } from "react";

// Matter's panel (remade 2026-10-15): the staff write in plain markdown, and the old panel printed it raw
// ("**A mistake I caught:**"). This reads the few marks they use (paragraphs, lists, bold, italic, code) into React
// elements. It never parses HTML, so a line can only ever be text.

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g;

function inline(text: string): ReactNode[] {
  return text.split(INLINE).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4)
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2)
      return <code key={index}>{part.slice(1, -1)}</code>;
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2)
      return <em key={index}>{part.slice(1, -1)}</em>;
    return <Fragment key={index}>{part}</Fragment>;
  });
}

const BULLET = /^\s*(?:[-*•]|\d+[.)])\s+/;

/** One message body: blank lines part paragraphs, and lines that start with a bullet or a number become a list. */
export function MessageText({ text }: { text: string }) {
  const blocks = text
    .replace(/\r\n/g, "\n")
    .trim()
    .split(/\n{2,}/);
  return (
    <div className="mp-text">
      {blocks.map((block, index) => {
        const lines = block.split("\n");
        if (lines.every((line) => BULLET.test(line))) {
          const ordered = /^\s*\d/.test(lines[0] ?? "");
          const items = lines.map((line, item) => (
            <li key={item}>{inline(line.replace(BULLET, ""))}</li>
          ));
          return ordered ? <ol key={index}>{items}</ol> : <ul key={index}>{items}</ul>;
        }
        const heading = /^#{1,6}\s+(.*)$/.exec(block);
        if (heading !== null && lines.length === 1)
          return (
            <p key={index} className="mp-text__heading">
              {inline(heading[1] ?? "")}
            </p>
          );
        return (
          <p key={index}>
            {lines.map((line, row) => (
              <Fragment key={row}>
                {row > 0 ? <br /> : null}
                {inline(line)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
