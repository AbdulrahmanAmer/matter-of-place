import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// B14 and H1 follow-ups: the workflow folder describes itself truthfully and the audit guard states what it costs.
const WORKFLOWS = new URL("../../../../.github/workflows/", import.meta.url);
const text = (name: string) => readFileSync(new URL(name, WORKFLOWS), "utf8");
const workflowFiles = () => readdirSync(WORKFLOWS).filter((name) => name.endsWith(".yml"));

describe("the workflow folder's README", () => {
  it("has a table row for every workflow file in the folder", () => {
    const rows = text("README.md")
      .split("\n")
      .filter((line) => line.startsWith("| `"));
    const missing = workflowFiles().filter(
      (name) => !rows.some((row) => row.split("|")[1]?.trim() === `\`${name}\``),
    );
    expect(missing).toEqual([]);
  });

  it("does not describe audit-scope.yml as the weekly audit robot", () => {
    expect(text("README.md")).not.toMatch(/audit-scope\.yml`[^\n]*weekly audit robot\)/);
    expect(text("README.md")).not.toContain("These three exist");
  });
});

describe("audit-scope.yml", () => {
  it("states its cost in Actions minutes and the P-009 budget it draws on (C22)", () => {
    const comment = text("audit-scope.yml")
      .split("\n")
      .filter((line) => line.startsWith("#"))
      .join("\n");
    expect(comment).toMatch(/Cost \(C22\)/);
    expect(comment).toMatch(/billed minutes a month/);
    expect(comment).toContain("P-009");
  });
});
