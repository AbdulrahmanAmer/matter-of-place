import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// workspace/05-plans/bank-merge.mjs in its fixture mode (no git). P-1831: two lanes that take the same number for
// different entries are a collision, not one entry changed on both sides; the tool refuses and the lane renumbers.
const SCRIPT = join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "workspace",
  "05-plans",
  "bank-merge.mjs",
);
const HEAD = "# Bank\n\nMap line.\n\n";
const entry = (id: string, heading: string) =>
  `## ${id} · ${heading}\n- symptom: s\n- cause: c\n- rule: r\n- proof: p\n- added: 2026-10-01`;

function run(base: string, ours: string, theirs: string) {
  const dir = mkdtempSync(join(tmpdir(), "bank-merge-"));
  const file = (name: string, text: string) => {
    const path = join(dir, name);
    writeFileSync(path, text);
    return path;
  };
  const out = join(dir, "out.md");
  const args = [
    "--base",
    file("base.md", base),
    "--ours",
    file("ours.md", ours),
    "--theirs",
    file("theirs.md", theirs),
  ];
  const result = spawnSync(process.execPath, [SCRIPT, ...args, "--out", out], { encoding: "utf8" });
  return {
    status: result.status,
    stderr: result.stderr,
    out: result.status === 0 ? readFileSync(out, "utf8") : "",
  };
}

describe("bank-merge.mjs", () => {
  const base = `${HEAD}${entry("P-001", "first")}\n`;

  it("refuses two different entries under one number and names both headings (P-1831)", () => {
    const ours = `${base}\n${entry("P-002", "the lane's entry")}\n`;
    const theirs = `${base}\n${entry("P-002", "main's entry")}\n`;
    const { status, stderr } = run(base, ours, theirs);
    expect({
      status,
      refused: stderr.includes("number collision P-002"),
      both: stderr.includes("main's entry") && stderr.includes("the lane's entry"),
    }).toEqual({ status: 1, refused: true, both: true });
  });

  it("merges one entry both sides changed, keeping main's text and the lane's extra line", () => {
    const changed = (extra: string) =>
      `${HEAD}${entry("P-001", "first").replace("- added:", `${extra}\n- added:`)}\n`;
    const { status, out } = run(base, changed("- hit again: lane"), changed("- note: main"));
    expect({
      status,
      hasLane: out.includes("- hit again: lane"),
      hasMain: out.includes("- note: main"),
      once: out.split("## P-001").length - 1,
    }).toEqual({ status: 0, hasLane: true, hasMain: true, once: 1 });
  });
});
