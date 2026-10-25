import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// docs/security.md "Dependency audit": every advisory an audit:deps script ignores is a recorded waiver there.
const doc = readFileSync(new URL("../../docs/security.md", import.meta.url), "utf8");
const section = doc.split("## Dependency audit")[1]?.split("\n## ")[0] ?? "";

function auditScript(packageFile: string): string {
  const value: unknown = JSON.parse(readFileSync(new URL(packageFile, import.meta.url), "utf8"));
  if (typeof value !== "object" || value === null || !("scripts" in value)) return "";
  const scripts = value.scripts;
  if (typeof scripts !== "object" || scripts === null || !("audit:deps" in scripts)) return "";
  return typeof scripts["audit:deps"] === "string" ? scripts["audit:deps"] : "";
}

const ignoredBy = (packageFile: string) =>
  [...auditScript(packageFile).matchAll(/--ignore=(GHSA-[\w-]+)/g)].map((match) => match[1] ?? "");

describe("audit:deps waivers", () => {
  it("ignores only advisories recorded as waivers in docs/security.md", () => {
    const ignored = ignoredBy("../../package.json");
    expect(ignored.length).toBeGreaterThan(0);
    expect(ignored.filter((id) => !section.includes(id))).toEqual([]);
  });

  it("ignores in launch/ only advisories recorded as waivers in docs/security.md", () => {
    const ignored = ignoredBy("../../../launch/package.json");
    expect(ignored.filter((id) => !section.includes(id))).toEqual([]);
  });
});
