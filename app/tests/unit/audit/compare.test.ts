import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import {
  chooseSidecars,
  compareSidecars,
  describeDeltas,
  newestSidecars,
} from "../../../../workspace/audits/tools/compare.mjs";

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

describe("choosing the two sidecars", () => {
  const dirs: string[] = [];
  afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });
  const folder = (names: string[]) => {
    const dir = mkdtempSync(join(tmpdir(), "compare-"));
    dirs.push(dir);
    for (const name of names) writeFileSync(join(dir, name), "{}");
    return dir;
  };

  it("takes the two newest dated files, newest first, and no other file", () => {
    const dir = folder(["2026-10-03.json", "2026-10-10.json", "2026-09-26.json", "notes.json"]);
    expect(chooseSidecars([], dir)).toEqual({
      current: join(dir, "2026-10-10.json"),
      previous: join(dir, "2026-10-03.json"),
    });
  });

  it("answers none for a missing folder and for a folder with one sidecar", () => {
    expect(chooseSidecars([], join(tmpdir(), "compare-no-such-folder-b14"))).toBeNull();
    expect(chooseSidecars([], folder(["2026-10-03.json"]))).toBeNull();
  });

  it("throws, and does not answer none, when the folder cannot be read", () => {
    const dir = folder(["2026-10-03.json"]);
    expect(() => newestSidecars(join(dir, "2026-10-03.json"))).toThrow(/ENOTDIR/);
  });

  it("refuses one path or three paths as a usage error", () => {
    expect(() => chooseSidecars(["a.json"])).toThrow(/got 1/);
    expect(() => chooseSidecars(["a.json", "b.json", "c.json"])).toThrow(/got 3/);
  });

  it("exits 2 with the usage line on stderr for a single path", () => {
    const run = spawnSync(
      process.execPath,
      [
        fileURLToPath(toolsUrl("compare.mjs")),
        fileURLToPath(toolsUrl("fixtures/sidecar-current.json")),
      ],
      { encoding: "utf8" },
    );
    expect(run.status).toBe(2);
    expect(run.stdout).toBe("");
    expect(run.stderr).toMatch(/^compare: pass <current> <previous>/);
  });
});
