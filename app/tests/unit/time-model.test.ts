import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// T-08: only pure unit tests may use `FIXED_NOW` and `at`. Everything that meets the database, the API or a
// browser dates its rows from `dbNow(db)` through `atFrom`, so a view that reads `now()` agrees on any calendar date.
const APP = fileURLToPath(new URL("../..", import.meta.url));
const FOLDERS = ["tests/db", "tests/api", "tests/e2e"];
const FILES = ["tests/fixtures/factories.ts", "tests/fixtures/dataset.ts"];
const FROM_CLOCK =
  /\b(?:import|export)\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["'][^"']*\/clock(?:\.ts)?["']/g;
const FORBIDDEN = new Set(["FIXED_NOW", "at"]);

/** The forbidden names a source file imports from `clock`, `import { at as shift }` included. */
function forbiddenImports(source: string): string[] {
  return [...source.matchAll(FROM_CLOCK)]
    .flatMap((match) => (match[1] ?? "").split(","))
    .map((specifier) =>
      (
        specifier
          .trim()
          .replace(/^type\s+/, "")
          .split(/\s+as\s+/)[0] ?? ""
      ).trim(),
    )
    .filter((name) => FORBIDDEN.has(name));
}

function sourcesUnder(folder: string): string[] {
  const root = join(APP, folder);
  if (!existsSync(root)) return [];
  return readdirSync(root, { recursive: true, encoding: "utf8" })
    .filter((name) => /\.tsx?$/.test(name))
    .map((name) => `${folder}/${name.replaceAll("\\", "/")}`);
}

const scanned = [
  ...FOLDERS.flatMap(sourcesUnder),
  ...FILES.filter((file) => existsSync(join(APP, file))),
];

describe("the forbidden-import detector", () => {
  it("finds FIXED_NOW and at, aliased, typed or spread over lines", () => {
    expect(forbiddenImports('import { FIXED_NOW } from "../fixtures/clock";')).toEqual([
      "FIXED_NOW",
    ]);
    expect(forbiddenImports('import { atFrom, at as shift } from "./clock.ts";')).toEqual(["at"]);
    expect(forbiddenImports('import {\n  mulberry32,\n  at,\n} from "../fixtures/clock";')).toEqual(
      ["at"],
    );
  });

  it("lets atFrom, the generators and other modules through", () => {
    expect(forbiddenImports('import { atFrom, mulberry32 } from "../fixtures/clock";')).toEqual([]);
    expect(forbiddenImports('import { at } from "date-fns";')).toEqual([]);
  });
});

describe("the time model", () => {
  it("scans the database layer", () => {
    expect(scanned).toContain("tests/db/harness.db.test.ts");
  });

  it("keeps FIXED_NOW and at out of every database, api and e2e file and the factories", () => {
    const offenders = scanned.flatMap((file) =>
      forbiddenImports(readFileSync(join(APP, file), "utf8")).map(
        (name) => `${file} imports ${name}`,
      ),
    );
    expect(offenders).toEqual([]);
  });
});
