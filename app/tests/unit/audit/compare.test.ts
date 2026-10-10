import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compareSidecars, describeDeltas } from "../../../../workspace/audits/tools/compare.mjs";

// B14 step 5: the deltas of one sidecar against the one before it, on two recorded sidecars.
const toolsUrl = (name: string) =>
  new URL(`../../../../workspace/audits/tools/${name}`, import.meta.url);
const sidecar = (name: string): unknown =>
  JSON.parse(readFileSync(toolsUrl(`fixtures/${name}.json`), "utf8"));

describe("compareSidecars", () => {
  const result = compareSidecars(sidecar("sidecar-current"), sidecar("sidecar-previous"));
  const lines = describeDeltas(result);

  it("prints a number's change with its sign, found by the line it belongs to and not by its position", () => {
    expect(lines).toContain("usage[actions_minutes].used  1000 -> 1400  +400");
    expect(lines).toContain("usage[actions_minutes].percent  50 -> 70  +20");
    expect(lines).toContain("cache.edge_hit_ratio  0.9 -> 0.96  +0.06");
  });

  it("prints a status change without a number", () => {
    expect(lines).toContain("usage[actions_minutes].status  watch -> DECISION");
    expect(lines).toContain("security.checks[strict-transport-security].status  red -> ok");
  });

  it("names what is new and what is gone, and counts what did not move", () => {
    expect(lines).toContain("usage[sentry_errors].used  new  581");
    expect(lines).toContain("cache.stale_count  gone  was 0");
    expect(lines.at(-1)).toBe("5 changed, 4 new, 1 gone, 6 unchanged");
  });

  it("reads neither the front block, the not_measured block nor a wording that changed", () => {
    expect(lines.join("\n")).not.toMatch(/front|not_measured|detail/);
  });

  it("is run from the command line on two files", () => {
    const run = spawnSync(
      process.execPath,
      [
        fileURLToPath(toolsUrl("compare.mjs")),
        fileURLToPath(toolsUrl("fixtures/sidecar-current.json")),
        fileURLToPath(toolsUrl("fixtures/sidecar-previous.json")),
      ],
      { encoding: "utf8" },
    );
    expect(run.status).toBe(0);
    expect(run.stdout.trim().split("\n")).toEqual(lines);
  });
});
