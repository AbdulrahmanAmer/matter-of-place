// scripts/preview-local.mjs, ruling H73: the pure half (arguments, the change test, the log and its reading by the
// merge gate). The run itself needs a build and `wrangler dev`; its proof is a real log under
// workspace/05-plans/logs/preview-local/.
import { describe, expect, it } from "vitest";
import { summary, verdict } from "../../scripts/lhci-pages.mjs";
import {
  STEPS,
  frontEndChanged,
  lighthouseStep,
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

describe("lighthouseStep, one run of scripts/lhci-pages.mjs (ruling H76)", () => {
  const base = "http://127.0.0.1:8970";
  const ok = { code: 0, signal: null, timedOut: false, output: "", seconds: 90 };
  const hung = { code: null, signal: "SIGINT", timedOut: true, output: "", seconds: 240 };
  const failed = {
    code: 1,
    signal: null,
    timedOut: false,
    output: "assert command failed. Exiting with status code 1.",
    seconds: 90,
  };
  // The output of lhci-pages: lhci's own lines, each url line after its url and again above the summary.
  const output = (verdicts: ReturnType<typeof verdict>[]) =>
    [
      ...verdicts.flatMap((one) => ["Running Lighthouse 3 time(s)", one.line]),
      "",
      ...verdicts.map((one) => one.line),
      summary(verdicts).line,
    ].join("\n");
  const pages = (code: number, verdicts: ReturnType<typeof verdict>[]) => {
    const stdout = output(verdicts);
    return { code, timedOut: false, lines: stdout.split("\n"), stdout, seconds: 312 };
  };
  const withSteps = (lighthouse: Step) =>
    log((steps) => steps.map((step) => (step.name === "lighthouse" ? lighthouse : step)));

  it("passes with the url and retry counts and keeps one line per url under its own heading", () => {
    const verdicts = [verdict(`${base}/`, [ok], 1200), verdict(`${base}/submit`, [hung, ok], 1200)];
    const step = lighthouseStep(pages(0, verdicts));
    expect([step.verdict, step.detail]).toEqual([
      "pass",
      "scripts/lhci-pages.mjs, 2 urls, 1 retried, 312 s",
    ]);
    const text = withSteps(step);
    expect(text).toContain("lighthouse | pass | scripts/lhci-pages.mjs, 2 urls, 1 retried, 312 s");
    expect(text).toContain(
      [
        "## lighthouse, one line per url (ruling H76)",
        "",
        "```text",
        `lighthouse ${base}/: pass`,
        `lighthouse ${base}/submit: pass (runtime, retried: stopped at its bound after 240 s)`,
        "```",
      ].join("\n"),
    );
    expect(localPreviewProblem(text, "227", HEAD)).toBe("");
  });

  it("fails on the script's exit, keeps the tail and the url lines, and the gate refuses it", () => {
    const verdicts = [verdict(`${base}/`, [ok], 1200), verdict(`${base}/exposure`, [failed], 1200)];
    const step = lighthouseStep(pages(1, verdicts));
    expect([step.verdict, step.detail, step.earlier?.[0]?.lines]).toEqual([
      "fail",
      "scripts/lhci-pages.mjs, 2 urls, 0 retried, exit 1 after 312 s",
      [`lighthouse ${base}/: pass`, `lighthouse ${base}/exposure: fail (assertion)`],
    ]);
    const text = withSteps(step);
    expect(text).toContain("## Output of lighthouse (last 8 lines)");
    expect(localPreviewProblem(text, "227", HEAD)).toBe(
      "lighthouse is fail in the log: scripts/lhci-pages.mjs, 2 urls, 0 retried, exit 1 after 312 s",
    );
  });

  it("fails a run that printed no summary, saying so", () => {
    const step = lighthouseStep({
      code: null,
      timedOut: true,
      lines: ["Run #1..."],
      stdout: "Run #1...",
      seconds: 1320,
    });
    expect([step.verdict, step.detail, step.earlier]).toEqual([
      "fail",
      "scripts/lhci-pages.mjs, no summary, stopped at its time limit after 1320 s",
      undefined,
    ]);
  });
});
