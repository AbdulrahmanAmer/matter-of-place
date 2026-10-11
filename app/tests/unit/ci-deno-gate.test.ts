import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// P-3121: the job runner's own entry is type-checked in CI with its lock file, so the fix of PR 272 cannot regress.
const CI = readFileSync(resolve(import.meta.dirname, "../../../.github/workflows/ci.yml"), "utf8");
const lines = CI.split(/\r?\n/).map((line) => line.trim());

describe("ci.yml deno step", () => {
  it("checks the portable entry and the job runner entry under the runner's deno.json", () => {
    expect(
      [
        "deno check --config supabase/functions/job-runner/deno.json scripts/deno-portable.ts",
        "deno check --frozen --config supabase/functions/job-runner/deno.json supabase/functions/job-runner/index.ts",
      ].map((command) => lines.filter((line) => line === command).length),
    ).toEqual([1, 1]);
  });

  it("runs both commands in the one step named deno", () => {
    const at = lines.indexOf("- name: deno");
    expect(at).toBeGreaterThan(0);
    expect(lines.slice(at + 1, at + 4)).toEqual([
      "run: |",
      "deno check --config supabase/functions/job-runner/deno.json scripts/deno-portable.ts",
      "deno check --frozen --config supabase/functions/job-runner/deno.json supabase/functions/job-runner/index.ts",
    ]);
  });
});
