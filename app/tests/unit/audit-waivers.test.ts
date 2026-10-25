import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// docs/security.md "Dependency audit": every advisory the audit:deps script ignores is a recorded waiver there.
const pkg: unknown = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
);
const doc = readFileSync(new URL("../../docs/security.md", import.meta.url), "utf8");

function auditScript(value: unknown): string {
  if (typeof value !== "object" || value === null || !("scripts" in value)) return "";
  const scripts = value.scripts;
  if (typeof scripts !== "object" || scripts === null || !("audit:deps" in scripts)) return "";
  return typeof scripts["audit:deps"] === "string" ? scripts["audit:deps"] : "";
}

describe("audit:deps waivers", () => {
  const ignored = [...auditScript(pkg).matchAll(/--ignore=(GHSA-[\w-]+)/g)].map(
    (match) => match[1] ?? "",
  );

  it("ignores only advisories recorded as waivers in docs/security.md", () => {
    expect(ignored.length).toBeGreaterThan(0);
    const section = doc.split("## Dependency audit")[1]?.split("\n## ")[0] ?? "";
    expect(ignored.filter((id) => !section.includes(id))).toEqual([]);
  });
});
