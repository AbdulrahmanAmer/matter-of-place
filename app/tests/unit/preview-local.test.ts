// scripts/preview-local.mjs, ruling H73: the pure half (arguments, the change test, the log and its reading by the
// merge gate). The run itself needs a build and `wrangler dev`; its proof is a real log under
// workspace/05-plans/logs/preview-local/.
import { describe, expect, it } from "vitest";
import {
  STEPS,
  frontEndChanged,
  lhciUrlArgs,
  localPreviewProblem,
  parseArgs,
  parseLog,
  renderLog,
  stamp,
} from "../../scripts/preview-local.mjs";

const HEAD = "0a59cc26632faeb8313bebcca9d20a407ba943c5";
type Step = Parameters<typeof renderLog>[0]["steps"][number];

const passed = (name: (typeof STEPS)[number]): Step => ({
  name,
  verdict: name === "observatory" ? "not run" : "pass",
  detail: name === "change test" ? "changed=true (3 files)" : "12 s",
  tail: [],
});

function log(
  change: (steps: Step[]) => Step[] = (steps) => steps,
  overrides: Partial<Parameters<typeof renderLog>[0]> = {},
) {
  return renderLog({
    pr: "227",
    head: HEAD,
    tree: "clean",
    date: "2026-10-08 21:50 +0300",
    port: 8970,
    mode: "live",
    steps: change(STEPS.map(passed)),
    ...overrides,
  });
}

const replace = (name: string, next: Partial<Step>) => (steps: Step[]) =>
  steps.map((step) => (step.name === name ? { ...step, ...next } : step));

describe("parseArgs", () => {
  it("reads the pull request, and defaults the port to 8970 and the mode to live", () => {
    expect([
      parseArgs(["--pr", "227"]),
      parseArgs(["--pr", "12", "--port", "8971", "--mode", "local"]),
    ]).toEqual([
      { pr: "227", port: 8970, mode: "live" },
      { pr: "12", port: 8971, mode: "local" },
    ]);
  });

  it("refuses a missing pull request, an unknown flag, a bad port or mode with the usage line", () => {
    const answers = [
      parseArgs([]),
      parseArgs(["--pr", "x"]),
      parseArgs(["--pr", "1", "--quick", "1"]),
      parseArgs(["--pr", "1", "--port", "80"]),
      parseArgs(["--pr", "1", "--mode", "edge"]),
    ];
    expect(
      answers.map((answer) => typeof answer === "string" && answer.startsWith("usage:")),
    ).toEqual([true, true, true, true, true]);
  });
});

describe("frontEndChanged, the change test of deploy.yml", () => {
  it("is true for app/src, app/public, package.json and budget.json and false for anything else", () => {
    expect([
      frontEndChanged(["workspace/05-plans/B7.md", "app/src/start.ts"]),
      frontEndChanged(["app/public/robots.txt"]),
      frontEndChanged(["app/package.json"]),
      frontEndChanged(["app/budget.json"]),
      frontEndChanged([
        "app/scripts/smoke.mjs",
        "app/tests/unit/x.test.ts",
        "app/package.json.bak",
      ]),
      frontEndChanged([]),
    ]).toEqual([true, true, true, true, false, false]);
  });
});

describe("lhciUrlArgs", () => {
  it("makes one --collect.url per printed line and drops blank lines", () => {
    expect(lhciUrlArgs("http://127.0.0.1:8970/\r\nhttp://127.0.0.1:8970/properties\n\n")).toEqual([
      "--collect.url=http://127.0.0.1:8970/",
      "--collect.url=http://127.0.0.1:8970/properties",
    ]);
  });
});

describe("stamp", () => {
  it("writes the local time with its numeric offset", () => {
    expect(stamp(new Date(2026, 9, 8, 21, 5))).toMatch(/^2026-10-08 21:05 [+-]\d{4}$/);
  });
});

describe("renderLog and parseLog", () => {
  it("writes one line per step and reads the header and the steps back", () => {
    const text = log(replace("smoke", { verdict: "fail", detail: "exit 1", tail: ["FAIL /x"] }));
    expect(text).toContain("smoke | fail | exit 1\n");
    expect(text).toContain("## Output of smoke (last 1 lines)");
    const read = parseLog(text);
    expect({
      pr: read.pr,
      head: read.head,
      tree: read.tree,
      mode: read.mode,
      names: read.steps.map((step) => step.name),
      smoke: read.steps.find((step) => step.name === "smoke"),
    }).toEqual({
      pr: "227",
      head: HEAD,
      tree: "clean",
      mode: "live",
      names: [...STEPS],
      smoke: { name: "smoke", verdict: "fail", detail: "exit 1" },
    });
  });
});

describe("localPreviewProblem, the merge gate's reading of a log (H73)", () => {
  it("accepts a log of this pull request and head where every hard step passed", () => {
    expect(localPreviewProblem(log(), "227", HEAD)).toBe("");
  });

  it("refuses another head, another pull request or a dirty tree", () => {
    expect([
      localPreviewProblem(log(), "227", "f".repeat(40)),
      localPreviewProblem(log(), "228", HEAD),
      localPreviewProblem(log(undefined, { tree: "dirty (2 changed files)" }), "227", HEAD),
    ]).toEqual([
      `the log's head ${HEAD} is not the pull request's head ${"f".repeat(40)}`,
      "the log is for pull request 227, not 228",
      "the log's tree was dirty (2 changed files), so the build was not the head",
    ]);
  });

  it("refuses a failed or unrun hard step, essentials included", () => {
    expect([
      localPreviewProblem(
        log(replace("essentials", { verdict: "fail", detail: "exit 1" })),
        "227",
        HEAD,
      ),
      localPreviewProblem(log(replace("smoke", { verdict: "not run", detail: "x" })), "227", HEAD),
    ]).toEqual(["essentials is fail in the log: exit 1", "smoke is not run in the log: x"]);
  });

  it("accepts skipped overflow and lighthouse only when the change test found no front-end change", () => {
    const skipped = (detail: string) =>
      log((steps) =>
        replace("lighthouse", { verdict: "skipped", detail: "no front-end change" })(
          replace("change test", { detail })(steps),
        ),
      );
    expect([
      localPreviewProblem(skipped("changed=false (2 files)"), "227", HEAD),
      localPreviewProblem(skipped("changed=true (2 files)"), "227", HEAD),
    ]).toEqual(["", "lighthouse is skipped in the log: no front-end change"]);
  });

  it("refuses a log whose steps are not the nine the script writes", () => {
    expect(
      localPreviewProblem(
        log((steps) => steps.filter((step) => step.name !== "wait")),
        "227",
        HEAD,
      ),
    ).toMatch(/^the log's steps are build, no-cron, smoke/);
  });
});
