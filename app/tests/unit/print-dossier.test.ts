import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// B7 step 7: the dossier prints as one column on letter paper, without the site's chrome (architecture 10, Delivery).

const SRC = join(import.meta.dirname, "..", "..", "src");
const read = (path: string) => readFileSync(join(SRC, path), "utf8");

describe("the dossier print stylesheet", () => {
  const css = read("styles/print.css");

  it("hides every element marked data-print=hide in print, on letter paper, with no colour of its own", () => {
    expect(css).toMatch(/@media print\s*{[\s\S]*\[data-print="hide"\]\s*{\s*display:\s*none/);
    expect(css).toMatch(/@page\s*{[^}]*size:\s*letter;[^}]*margin:\s*0\.75in;/);
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
  });

  it("is imported by the site's stylesheet entry", () => {
    expect(read("styles.css")).toContain('@import "./styles/print.css";');
  });

  it.each([
    ["components/layout/header.tsx", /<header className=[^>]*data-print="hide"/],
    ["components/layout/footer.tsx", /<footer className="site-footer" data-print="hide">/],
    [
      "components/property/concierge.tsx",
      /<aside className="concierge-panel"[^>]*data-print="hide"/,
    ],
    [
      "components/property/sticky-actions.tsx",
      /<div className="sticky-actions"[^>]*data-print="hide"/,
    ],
  ])("%s marks its root element data-print=hide", (path, root) => {
    expect(read(path)).toMatch(root);
  });
});
