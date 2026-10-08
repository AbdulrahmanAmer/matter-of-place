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

function run(base: string, ours: string, theirs: string, mergeBase?: string) {
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
  if (mergeBase !== undefined) args.push("--merge-base", join(dir, mergeBase));
  const result = spawnSync(process.execPath, [SCRIPT, ...args, "--out", out], { encoding: "utf8" });
  return {
    status: result.status,
    stderr: result.stderr,
    stdout: result.stdout,
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

  // 2026-10-08, PR 230: the lane rewrote the rule line of P-1917, main still held the base line, and the tool
  // refused "line lost: main P-1917: - rule: ..." where git's three-way merge had no conflict at all.
  describe("a line one side rewrote while the other kept the merge base's copy", () => {
    const withRule = (rule: string, extra = "") =>
      `${HEAD}${entry("P-001", "first").replace("- rule: r", `- rule: ${rule}`).replace("- added:", `${extra}- added:`)}\n`;
    const other = `${entry("P-002", "other")}\n`;

    it("is superseded, not lost: the lane's rewritten rule is kept and the summary names it", () => {
      const { status, out, stdout } = run(
        `${withRule("r")}\n${other}`,
        `${withRule("r rewritten")}\n${other}`,
        `${withRule("r")}\n${other.replace("- cause: c", "- cause: c2")}`,
      );
      expect({
        status,
        rewritten: out.includes("- rule: r rewritten"),
        oldRule: out.split("## P-002")[0]?.includes("- rule: r\n"),
        said: stdout.includes("superseded 1 line (lane rewrote P-001 rule)"),
      }).toEqual({ status: 0, rewritten: true, oldRule: false, said: true });
    });

    it("replaces main's copy in an entry both sides changed, and keeps main's own additions", () => {
      const { status, out, stdout } = run(
        withRule("r"),
        withRule("r rewritten"),
        withRule("r", "- hit again: main\n"),
      );
      expect({
        status,
        rewritten: out.includes("- rule: r rewritten"),
        oldRule: out.includes("- rule: r\n"),
        main: out.includes("- hit again: main"),
        said: stdout.includes("superseded 1 line (lane rewrote P-001 rule)"),
      }).toEqual({ status: 0, rewritten: true, oldRule: false, main: true, said: true });
    });

    it("lets main's rewrite supersede the lane's untouched copy the same way", () => {
      const { status, out, stdout } = run(
        withRule("r"),
        withRule("r", "- hit again: lane\n"),
        withRule("r rewritten"),
      );
      expect({
        status,
        rewritten: out.includes("- rule: r rewritten"),
        oldRule: out.includes("- rule: r\n"),
        lane: out.includes("- hit again: lane"),
        said: stdout.includes("superseded 1 line (main rewrote P-001 rule)"),
      }).toEqual({ status: 0, rewritten: true, oldRule: false, lane: true, said: true });
    });

    it("supersedes nothing when both sides changed the same line differently: both lines stay for a human", () => {
      const { status, out, stdout } = run(
        withRule("r"),
        withRule("r by the lane"),
        withRule("r by main"),
      );
      expect({
        status,
        lane: out.includes("- rule: r by the lane"),
        main: out.includes("- rule: r by main"),
        silent: !stdout.includes("superseded"),
      }).toEqual({ status: 0, lane: true, main: true, silent: true });
    });

    it("keeps today's refusal when the merge base cannot be read", () => {
      const { status, stderr, stdout } = run(
        withRule("r"),
        withRule("r rewritten"),
        withRule("r"),
        "no-such-merge-base.md",
      );
      expect({
        status,
        lost: stderr.includes("line lost: main P-001: - rule: r"),
        silent: !stdout.includes("superseded"),
      }).toEqual({ status: 1, lost: true, silent: true });
    });
  });
});
