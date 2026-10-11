import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// WCAG 2.2 target size (2.5.8) on the Settings products editor: the e2e axe checkpoint caught a 13px "recommended" radio.
// The browser proof is tests/e2e/exposure-products.spec.ts; this keeps the rule that fixes it from being dropped.
const css = readFileSync(join(process.cwd(), "src/styles/admin/settings.css"), "utf8");

function block(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) return "";
  return css.slice(start, css.indexOf("}", start));
}

describe("the Settings products editor", () => {
  it("sizes the recommended radio to a 24 by 24 target", () => {
    const rule = block('.admin-plan__flag > input[type="radio"]');
    expect(rule).toMatch(/inline-size:\s*24px/);
    expect(rule).toMatch(/block-size:\s*24px/);
  });
});
