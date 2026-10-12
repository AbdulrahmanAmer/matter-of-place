import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Operator, 2026-10-12 (Pixel 9): the home headline lost "property." and "considered." on phones. The reveal
// (`lineRise` in motion.css) clips each phrase with clip-path, and an inline phrase that wraps is clipped to its first
// line, so the phrases must stay blocks at every width.
const css = (name: string) => readFileSync(join(process.cwd(), "src/styles", name), "utf8");

describe("the home headline", () => {
  it("never makes a revealed phrase inline, at any width", () => {
    const hero = css("components/hero.css");
    const inlineRules = [...hero.matchAll(/\.hero-text h1 span\s*\{([^}]*)\}/g)]
      .map((match) => match[1] ?? "")
      .filter((body) => /display:\s*inline\b/.test(body));
    expect({
      revealed: /\.hero-text h1 span\s*\{[^}]*animation:\s*lineRise/.test(css("motion.css")),
      inlineRules,
    }).toEqual({ revealed: true, inlineRules: [] });
  });
});
