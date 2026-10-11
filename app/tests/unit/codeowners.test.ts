import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// H79 (5): .github/CODEOWNERS has one line per top folder of the repository and one owner for every path.
const OWNER = "@AbdulrahmanAmer";
const root = new URL("../../../", import.meta.url);

const rules = readFileSync(new URL(".github/CODEOWNERS", root), "utf8")
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line !== "" && !line.startsWith("#"))
  .map((line) => line.split(/\s+/));

const trackedFolders = [
  ...new Set(
    execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8", maxBuffer: 1 << 28 })
      .split("\0")
      .filter((file) => file.includes("/"))
      .map((file) => file.slice(0, file.indexOf("/"))),
  ),
].sort();

describe(".github/CODEOWNERS", () => {
  it("names the one owner on every line", () => {
    expect(rules.filter(([, ...owners]) => owners.join(" ") !== OWNER)).toEqual([]);
  });

  it("has exactly one line for each top folder and one for the files in the root", () => {
    const patterns = rules.map(([pattern]) => pattern);
    expect(patterns.slice().sort()).toEqual([...trackedFolders.map((f) => `/${f}/`), "/*"].sort());
  });
});
