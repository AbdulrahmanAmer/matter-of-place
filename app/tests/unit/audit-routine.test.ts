import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { routinePrompt } from "../../scripts/audit-routine.ts";

// Gap audit item 25: the Saturday routine runs the prompt of ROUTINE-PROMPT.md word for word.

describe("the audit routine", () => {
  it("takes the fenced prompt of ROUTINE-PROMPT.md and nothing around it", () => {
    const prompt = routinePrompt(
      readFileSync(join(process.cwd(), "../workspace/audits/ROUTINE-PROMPT.md"), "utf8"),
    );
    expect([
      prompt.startsWith("Read GOTCHAS.md and .claude/agents/mop-auditor.md"),
      prompt.includes("run-all.mjs"),
      prompt.includes("## Rules"),
    ]).toEqual([true, true, false]);
  });

  it("refuses a file with no fenced prompt", () => {
    expect(() => routinePrompt("# no prompt here")).toThrow("no fenced prompt");
  });
});
