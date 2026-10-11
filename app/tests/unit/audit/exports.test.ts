import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// knip does not scan workspace/ or the root scripts/ (B14 g2 follow-up, R04/C04): a name exported from an audit tool
// that nothing else mentions is dead surface, and this is the gate that says so. A word match is a loose test of
// "imported" (a generic name such as `collect` passes on any mention), so it catches the names nobody uses at all.
const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const TOOL_FOLDERS = ["workspace/audits/tools", "scripts/audit"];
const READERS = [...TOOL_FOLDERS, "app/tests", "app/scripts"];

function filesOf(folder: string, pattern: RegExp): string[] {
  return readdirSync(join(ROOT, folder), { recursive: true, encoding: "utf8" })
    .filter((name) => pattern.test(name) && !name.includes("fixtures"))
    .map((name) => join(ROOT, folder, name));
}

const EXPORTED = /^export (?:async )?(?:function|const|class) +([A-Za-z0-9_]+)/gm;

describe("the audit tools' exports", () => {
  it("are each mentioned by another file of the tools, the tests or the app's scripts", () => {
    const sources = new Map<string, string>();
    for (const folder of READERS) {
      for (const file of filesOf(folder, /\.(?:mjs|ts)$/)) {
        sources.set(file, readFileSync(file, "utf8"));
      }
    }
    const unused: string[] = [];
    for (const folder of TOOL_FOLDERS) {
      for (const file of filesOf(folder, /\.mjs$/)) {
        const own = sources.get(file) ?? "";
        for (const match of own.matchAll(EXPORTED)) {
          const name = match[1] ?? "";
          const word = new RegExp(`\\b${name}\\b`);
          const used = [...sources].some(([other, text]) => other !== file && word.test(text));
          if (!used) unused.push(`${relative(ROOT, file).replaceAll("\\", "/")} ${name}`);
        }
      }
    }
    expect(unused).toEqual([]);
  });

  it("are found by the scan: the folders hold exported names to judge", () => {
    const files = TOOL_FOLDERS.flatMap((folder) => filesOf(folder, /\.mjs$/));
    const names = files.flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(EXPORTED)].map((match) => match[1]),
    );
    expect(files.length).toBeGreaterThan(15);
    expect(names.length).toBeGreaterThan(40);
  });
});
