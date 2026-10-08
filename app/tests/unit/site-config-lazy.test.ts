import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// P-2411: Nitro regroups the server chunks by the module graph, and a graph can put `config/site.ts` after a module
// that reads it while the module loads, so the built Worker answers 500 on every page ("Cannot read properties of
// undefined (reading 'name')"). A module reads `siteConfig` inside a function, never when it loads.
const SRC = join(import.meta.dirname, "..", "..", "src");
const AT_LOAD =
  /^(?:export )?(?:const|let|var) [^=\n]*=(?![^\n]*(?:=>|function\b))[^\n]*\bsiteConfig\./;

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((item) => {
    const path = join(dir, item.name);
    if (item.isDirectory()) return sources(path);
    return /\.tsx?$/.test(item.name) && !/\.test\.tsx?$/.test(item.name) ? [path] : [];
  });
}

describe("siteConfig", () => {
  it("is read inside functions, never in a statement that runs when the module loads", () => {
    const offending = sources(SRC).flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .flatMap((line, index) =>
          AT_LOAD.test(line) ? [`${relative(SRC, file)}:${String(index + 1)}: ${line.trim()}`] : [],
        ),
    );
    expect(offending).toEqual([]);
  });
});
