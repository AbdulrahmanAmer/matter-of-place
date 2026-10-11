// B18 invariant 1: one source of the plans at runtime, `settings.products`. The seed constant is read by its own file,
// the server's seed and the local adapter, and by nothing else under `src`; a price is quoted in no other static copy.
// Outside the app, the launch film's extractor is the one allowed reader: it has no database and quotes the seed.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SEED_READERS = [
  "src/data/exposure.ts",
  "src/server/settings/products.ts",
  "src/services/local/site.ts",
];
const LAUNCH_SEED_READERS = ["../launch/shared/extract-exposure.mjs"];

function sourceFiles(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name).replaceAll("\\", "/");
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sourceFiles(path);
    return /\.(tsx?|mjs)$/.test(entry.name) && !path.endsWith(".gen.ts") ? [path] : [];
  });
}

const filesMatching = (folders: readonly string[], pattern: RegExp): string[] =>
  folders
    .flatMap(sourceFiles)
    .filter((path) => pattern.test(readFileSync(path, "utf8")))
    .sort();

describe("the source of the plans", () => {
  it("lets only the data file, the server seed and the local adapter name seedOfferings", () => {
    expect(filesMatching(["src"], /\bseedOfferings\b/)).toEqual(SEED_READERS);
  });

  it("lets only the launch film's extractor name seedOfferings outside the app", () => {
    expect(filesMatching(["../launch"], /\bseedOfferings\b/)).toEqual(LAUNCH_SEED_READERS);
  });

  it("quotes a dollar amount under src/data and src/routes only in the seed and the programmatic terms", () => {
    expect(filesMatching(["src/data", "src/routes"], /\$\d/)).toEqual(["src/data/exposure.ts"]);
  });
});
