import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const SCRIPT = resolve(import.meta.dirname, "../../scripts/stubs.ts");

function plan(b3Status: string): string {
  return [
    "| Slice | Status | Closed on | Proof |",
    "|---|---|---|---|",
    "| B1b | in progress | | |",
    `| B3 | ${b3Status} | | |`,
    "",
  ].join("\n");
}

let dir = "";

function run(planText: string, ...flags: string[]) {
  const planPath = join(dir, "PLAN.md");
  writeFileSync(planPath, planText);
  return spawnSync("bun", [SCRIPT, "--plan", planPath, ...flags], { cwd: dir, encoding: "utf8" });
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "stubs-"));
  mkdirSync(join(dir, "src"));
  writeFileSync(
    join(dir, "src", "a.ts"),
    ["export const a = 1;", "// STUB(B3 step 2): the cached render", "export const b = 2;"].join(
      "\n",
    ),
  );
  writeFileSync(
    join(dir, "src", "b.ts"),
    "// STUB(post-v1): the second market\nexport const c = 3;\n",
  );
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("stubs ledger", () => {
  it("passes while the slice of every marker is open", () => {
    const result = run(plan("not started"));
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("stubs: 2 markers, 0 on closed slices");
  });

  it("fails naming file and line when the slice is closed", () => {
    const result = run(plan("closed"));
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("src/a.ts:2 STUB(B3) slice is closed");
    expect(result.stdout).not.toContain("src/b.ts:1 STUB(post-v1) slice is closed");
  });

  it("lists a marker whose slice is not in the table without failing", () => {
    const result = run(plan("closed").replace("B3", "B4"));
    expect(result.stdout).toContain("src/a.ts:2 STUB(B3): the cached render");
    expect(result.status).toBe(0);
  });

  it("counts only the markers that are not post-v1", () => {
    const result = run(plan("not started"), "--count-non-v1");
    expect(result.stdout.trim()).toBe("1");
  });
});
