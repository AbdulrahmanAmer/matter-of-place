import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// GQ-06 and the brand: nothing in the admin stylesheet moves unless the person allows motion.
const DIR = join(process.cwd(), "src/styles/admin");
const sheets = readdirSync(DIR)
  .filter((name) => name.endsWith(".css"))
  .map((name) => ({ name, css: readFileSync(join(DIR, name), "utf8") }));

const REDUCED_MOTION = /@media \(prefers-reduced-motion: (no-preference|reduce)\)\s*\{/g;

interface Split {
  /** The sheet with every reduced-motion block taken out. */
  outside: string;
  allowed: string[];
  reduced: string[];
}

/** Takes each `@media (prefers-reduced-motion: ...)` block out of `css` by matching its braces. */
function splitMotion(css: string): Split {
  const split: Split = { outside: "", allowed: [], reduced: [] };
  let from = 0;
  for (const match of css.matchAll(REDUCED_MOTION)) {
    if (match.index < from) continue;
    let depth = 1;
    let end = match.index + match[0].length;
    while (depth > 0 && end < css.length) {
      depth += css[end] === "{" ? 1 : css[end] === "}" ? -1 : 0;
      end += 1;
    }
    split.outside += css.slice(from, match.index);
    (match[1] === "no-preference" ? split.allowed : split.reduced).push(
      css.slice(match.index, end),
    );
    from = end;
  }
  split.outside += css.slice(from);
  return split;
}

const MOVES = /(?:^|[\s;{])(?:transition|animation)(?:-[a-z-]+)?\s*:|@keyframes/;

describe("the admin stylesheet", () => {
  it("has no transition or animation outside the reduced-motion rule", () => {
    expect(sheets.length).toBeGreaterThan(0);
    const moving = sheets.filter(({ css }) => MOVES.test(splitMotion(css).outside));
    expect(moving.map((sheet) => sheet.name)).toEqual([]);
  });

  it("puts its motion in one no-preference block and switches animation off under reduce", () => {
    const ui = splitMotion(sheets.find((sheet) => sheet.name === "ui.css")?.css ?? "");
    expect(ui.allowed).toHaveLength(1);
    expect(MOVES.test(ui.allowed.join(""))).toBe(true);
    expect(ui.reduced.join("")).toMatch(/animation:\s*none/);
  });

  it("takes the tokens and its own files only, and draws no gradient, shadow or hex", () => {
    const index = sheets.find((sheet) => sheet.name === "index.css")?.css ?? "";
    const imports = [...index.matchAll(/@import "([^"]+)"/g)].map((match) => match[1]);
    const own = sheets
      .filter((sheet) => sheet.name !== "index.css")
      .map((sheet) => `./${sheet.name}`);
    expect(imports).toEqual(["../tokens.css", ...own]);
    const drawn = sheets.filter(({ css }) =>
      /gradient|box-shadow|text-shadow|filter:\s*drop-shadow|#[0-9a-fA-F]{3,8}\b/.test(css),
    );
    expect(drawn.map((sheet) => sheet.name)).toEqual([]);
  });
});
