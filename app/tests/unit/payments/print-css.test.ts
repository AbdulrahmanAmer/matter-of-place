import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Invariant 11 (GQ-06): the admin invoice pages print cleanly on US Letter. The sheet is read as text: a print
// rule cannot be seen from jsdom, so the test holds the rules the plan names. No admin sheet may draw a shadow
// (admin-motion.test.ts), so the preview prints with none.
const STYLES = join(import.meta.dirname, "..", "..", "..", "src", "styles", "admin");
const css = readFileSync(join(STYLES, "invoices.css"), "utf8");
const entry = readFileSync(join(STYLES, "index.css"), "utf8");

/** The text of the first `@media print { ... }` block, braces balanced. */
function printBlock(source: string): string {
  const start = source.indexOf("@media print");
  if (start === -1) return "";
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let at = open; at < source.length; at += 1) {
    if (source[at] === "{") depth += 1;
    if (source[at] === "}") depth -= 1;
    if (depth === 0) return source.slice(open + 1, at);
  }
  return "";
}

const printed = printBlock(css);

/** The declarations of the rule whose selector list contains `selector`, inside the print block. */
function ruleOf(selector: string): string {
  const rule = [...printed.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find((match) =>
    (match[1] ?? "").split(",").some((part) => part.trim() === selector),
  );
  return rule?.[2] ?? "";
}

describe("invoices.css print block", () => {
  it("is linked from the admin entry stylesheet", () => {
    expect(entry).toContain('@import "./invoices.css";');
  });

  it("sets the page to US Letter with literal margins", () => {
    expect(css).toMatch(/@page\s*\{\s*size:\s*letter;\s*margin:\s*0\.75in;\s*\}/);
  });

  it("hides every element marked data-print hide", () => {
    expect(ruleOf('[data-print="hide"]')).toMatch(/display:\s*none/);
  });

  it("shows the invoice in the foreground on the background, with no shadow, no fixed position and one page", () => {
    const rule = ruleOf(".admin-invoice");
    expect({
      ink: /color:\s*var\(--foreground\)/.test(rule),
      ground: /background:\s*var\(--background\)/.test(rule),
      shadow: /shadow/.test(css),
      position: /position:\s*static/.test(rule),
      width: /width:\s*100%/.test(rule),
      page: /break-inside:\s*avoid/.test(rule),
    }).toEqual({ ink: true, ground: true, shadow: false, position: true, width: true, page: true });
  });

  it("uses no fixed positioning and no colour but the tokens in print", () => {
    expect({
      fixed: /position:\s*fixed/.test(printed),
      literal: /#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(css),
    }).toEqual({ fixed: false, literal: false });
  });
});
