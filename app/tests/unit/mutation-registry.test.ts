import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { entryProblems, loadRegistries } from "../../scripts/watchfail.mjs";

// T-07, R49: every test file has an entry in a registry `tests/mutations/<slice>.json`, so a watched-fail can be
// replayed (`node scripts/watchfail.mjs --registry tests/mutations`) and a test that stopped measuring is found.
const APP = fileURLToPath(new URL("../..", import.meta.url));
const registries = loadRegistries(join(APP, "tests/mutations"));
const entries = registries.flatMap(({ registry, entries: all }) =>
  all.map((entry) => ({ registry, entry })),
);

const TEST_FILE = /^tests\/(?:.+\.test\.tsx?|e2e\/[^/]+\.spec\.ts)$/;
const testFiles = readdirSync(join(APP, "tests"), { recursive: true, encoding: "utf8" })
  .map((name) => `tests/${name.replaceAll("\\", "/")}`)
  .filter((name) => TEST_FILE.test(name) && !name.startsWith("tests/fixtures/"))
  .sort();

describe("the mutation registries", () => {
  it("hold entries the replay tool can run", () => {
    const malformed = entries.flatMap(({ registry, entry }) => {
      const problems = entryProblems(entry);
      return problems.length === 0
        ? []
        : [`${registry}: ${JSON.stringify(entry)}: ${problems.join(", ")}`];
    });
    expect(malformed).toEqual([]);
  });

  it("use each id once per registry file", () => {
    const seen = new Set<string>();
    const repeated: string[] = [];
    for (const { registry, entry } of entries) {
      const id = `${registry}:${JSON.stringify(entry && typeof entry === "object" && "id" in entry ? entry.id : null)}`;
      if (seen.has(id)) repeated.push(id);
      seen.add(id);
    }
    expect(repeated).toEqual([]);
  });

  it("name every test file as the test of at least one entry", () => {
    const named = new Set(
      entries.flatMap(({ entry }) =>
        entry && typeof entry === "object" && "test" in entry && typeof entry.test === "string"
          ? [entry.test]
          : [],
      ),
    );
    expect(testFiles.filter((file) => !named.has(file))).toEqual([]);
  });
});
