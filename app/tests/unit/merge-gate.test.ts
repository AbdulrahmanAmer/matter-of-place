import { describe, expect, it } from "vitest";
import {
  REQUIRED_PR_CHECKS,
  evaluateMergeGate,
  gatherInput,
  jobKeys,
} from "../../scripts/merge-gate.mjs";
import { mergeGate } from "../../../workspace/05-plans/merge-gate.mjs";

const SHA = "abaa02de74944bfc2f0a39825849da50628bb840";
const HEAD = "0a59cc26632faeb8313bebcca9d20a407ba943c5";
const PR = { number: 23, author: "AbdulrahmanAmer" };
const DEFINED = ["check", "build", "db", "e2e", "preview", "merge-gate"];

const run = (name: string, conclusion: string | null, status = "completed", id = 1) => ({
  id,
  name,
  status,
  conclusion,
});
const GREEN = REQUIRED_PR_CHECKS.map((name) => run(name, "success"));
const GATE = [{ context: "merge-gate", state: "success" }];
const OK = `merge-gate: OK ${SHA} (pull request #23)`;

function evaluate(overrides: Partial<Parameters<typeof evaluateMergeGate>[0]> = {}) {
  return evaluateMergeGate({
    sha: SHA,
    pr: PR,
    statuses: GATE,
    checkRuns: GREEN,
    definedJobs: DEFINED,
    ciHeavy: undefined,
    ...overrides,
  });
}

describe("REQUIRED_PR_CHECKS", () => {
  it("names the pull request jobs, not the steps merged into them", () => {
    expect(REQUIRED_PR_CHECKS).toEqual(["check", "build", "db", "e2e", "preview"]);
  });
});

describe("evaluateMergeGate", () => {
  it("passes when the merge-gate status and every required check are success", () => {
    expect(evaluate()).toEqual({ ok: true, lines: [OK] });
  });

  it("refuses a failed e2e and names it", () => {
    const checkRuns = GREEN.map((r) => (r.name === "e2e" ? run("e2e", "failure") : r));
    expect(evaluate({ checkRuns })).toEqual({
      ok: false,
      lines: [`unverified merge ${SHA}: e2e failure`],
    });
  });

  it("refuses a check that has not finished", () => {
    const checkRuns = GREEN.map((r) =>
      r.name === "build" ? run("build", null, "in_progress") : r,
    );
    expect(evaluate({ checkRuns }).lines).toEqual([`unverified merge ${SHA}: build in_progress`]);
  });

  it("refuses a required check that has no run on the head", () => {
    const checkRuns = GREEN.filter((r) => r.name !== "check");
    expect(evaluate({ checkRuns }).lines).toEqual([`unverified merge ${SHA}: check missing`]);
  });

  it("refuses a head without the merge-gate status, or with one that is not success", () => {
    expect([
      evaluate({ statuses: [] }).lines,
      evaluate({ statuses: [{ context: "merge-gate", state: "pending" }] }).lines,
      evaluate({ statuses: [{ context: "other", state: "success" }] }).lines,
    ]).toEqual([
      [`unverified merge ${SHA}: merge-gate missing`],
      [`unverified merge ${SHA}: merge-gate pending`],
      [`unverified merge ${SHA}: merge-gate missing`],
    ]);
  });

  it("refuses a commit that is no merged pull request", () => {
    expect(evaluate({ pr: null })).toEqual({
      ok: false,
      lines: [`unverified merge ${SHA}: no pull request`],
    });
  });

  it("does not require a check that no workflow at the commit defines", () => {
    const checkRuns = GREEN.filter((r) => r.name !== "db" && r.name !== "e2e");
    const definedJobs = DEFINED.filter((name) => name !== "db" && name !== "e2e");
    expect(evaluate({ checkRuns, definedJobs })).toEqual({ ok: true, lines: [OK] });
  });

  it("does not require preview from Dependabot, and says so", () => {
    const checkRuns = GREEN.filter((r) => r.name !== "preview");
    const dependabot = { number: 24, author: "dependabot[bot]" };
    expect([evaluate({ pr: dependabot, checkRuns }).lines, evaluate({ checkRuns }).lines]).toEqual([
      [
        "preview not required: author is dependabot[bot]",
        `merge-gate: OK ${SHA} (pull request #24)`,
      ],
      [`unverified merge ${SHA}: preview missing`],
    ]);
  });

  it("refuses a skipped e2e unless CI_HEAVY is off, and never a skipped check or build", () => {
    const skipped = (name: string) =>
      GREEN.map((r) => (r.name === name ? run(name, "skipped") : r));
    expect([
      evaluate({ checkRuns: skipped("e2e") }).lines,
      evaluate({ checkRuns: skipped("e2e"), ciHeavy: "on" }).lines,
      evaluate({ checkRuns: skipped("e2e"), ciHeavy: "off" }).lines,
      evaluate({ checkRuns: skipped("build"), ciHeavy: "off" }).lines,
    ]).toEqual([
      [`unverified merge ${SHA}: e2e skipped`],
      [`unverified merge ${SHA}: e2e skipped`],
      ["heavy check skipped (CI_HEAVY=off): e2e", OK],
      [`unverified merge ${SHA}: build skipped`],
    ]);
  });
});

describe("evaluateMergeGate, a head with several runs of one check", () => {
  const rest = GREEN.filter((r) => r.name !== "preview" && r.name !== "e2e");

  it("judges the latest run of a name, wherever the list puts it", () => {
    const earlier = [
      run("preview", "skipped", "completed", 5),
      run("e2e", "cancelled", "completed", 6),
    ];
    const later = [
      run("preview", "success", "completed", 9),
      run("e2e", "success", "completed", 8),
    ];
    expect([
      evaluate({ checkRuns: [...rest, ...earlier, ...later] }).lines,
      evaluate({ checkRuns: [...later, ...earlier, ...rest] }).lines,
    ]).toEqual([[OK], [OK]]);
  });

  it("refuses when the latest run failed, whatever an older run of the name did", () => {
    const checkRuns = [
      ...GREEN.filter((r) => r.name !== "build"),
      run("build", "success", "completed", 5),
      run("build", "failure", "completed", 9),
    ];
    expect(evaluate({ checkRuns }).lines).toEqual([`unverified merge ${SHA}: build failure`]);
  });
});

describe("jobKeys", () => {
  it("reads the job keys of the jobs map and nothing else", () => {
    const text = [
      "name: ci",
      "on:",
      "  push:",
      "    branches: [main]",
      "jobs:",
      "  check:",
      "    runs-on: ubuntu-24.04",
      "    permissions:",
      "      contents: read",
      "  # a comment between jobs",
      "  merge-gate:",
      "    if: github.event_name == 'push'",
      "# a comment at the margin",
      "  build_2:",
      "    steps: []",
      "",
    ].join("\n");
    expect(jobKeys(text)).toEqual(["check", "merge-gate", "build_2"]);
  });

  it("stops at the next top-level key", () => {
    expect(jobKeys("jobs:\n  a:\n    steps: []\nenv:\n  b: 1\n")).toEqual(["a"]);
  });
});

describe("gatherInput", () => {
  const WORKFLOW = "name: ci\njobs:\n  check:\n    steps: []\n  build:\n    steps: []\n";
  // Recorded from `gh api` with the --jq filters of scripts/merge-gate.mjs (2026-10-02).
  const PULLS = `${SHA}\t23\t${HEAD}\tAbdulrahmanAmer\n`;
  const STATUS = "merge-gate\tsuccess\n";
  const RUNS = "11\tcheck\tcompleted\tsuccess\n12\tbuild\tin_progress\t\n";

  function gather(pulls = PULLS) {
    const calls: string[] = [];
    const input = gatherInput({
      sha: SHA,
      workflows: [WORKFLOW],
      ciHeavy: "off",
      gh: (args) => {
        const path = args.find((arg) => arg.startsWith("repos/")) ?? "";
        calls.push(path);
        if (path.endsWith("/pulls")) return pulls;
        return path.includes("/status") ? STATUS : RUNS;
      },
    });
    return { input, calls };
  }

  it("finds the pull request merged as this commit and reads its head", () => {
    const { input, calls } = gather();
    expect({
      pr: input.pr,
      statuses: input.statuses,
      checkRuns: input.checkRuns,
      definedJobs: input.definedJobs,
      ciHeavy: input.ciHeavy,
      calls,
    }).toEqual({
      pr: PR,
      statuses: GATE,
      checkRuns: [run("check", "success", "completed", 11), run("build", null, "in_progress", 12)],
      definedJobs: ["check", "build"],
      ciHeavy: "off",
      calls: [
        `repos/AbdulrahmanAmer/matter-of-place/commits/${SHA}/pulls`,
        `repos/AbdulrahmanAmer/matter-of-place/commits/${HEAD}/status?per_page=100`,
        `repos/AbdulrahmanAmer/matter-of-place/commits/${HEAD}/check-runs?per_page=100`,
      ],
    });
  });

  it("ignores a pull request that only contains the commit and reads no head", () => {
    const { input, calls } = gather(`${HEAD}\t30\t${HEAD}\tsomeone\n`);
    expect({ pr: input.pr, calls: calls.length }).toEqual({ pr: null, calls: 1 });
  });

  it("says no pull request when the commit has none", () => {
    expect(evaluateMergeGate(gather("").input).lines).toEqual([
      `unverified merge ${SHA}: no pull request`,
    ]);
  });
});

describe("workspace/05-plans/merge-gate.mjs", () => {
  const HEAD_SHA = "0a59cc26632faeb8313bebcca9d20a407ba943c5";
  const WRITES = ["gh api -X", "gh pr merge"];

  function gate(
    checks: { status: number; out: string },
    view = `${HEAD_SHA}\tfalse`,
    ancestor = 0,
  ) {
    const calls: string[] = [];
    const result = mergeGate("22", (command, args) => {
      calls.push(`${command} ${args.slice(0, 2).join(" ")}`);
      const empty = { status: 0, out: "", err: "" };
      if (command === "git") return { ...empty, status: args[0] === "merge-base" ? ancestor : 0 };
      if (args[1] === "view") return { ...empty, out: view };
      if (args[1] === "checks") return { ...empty, ...checks };
      return empty;
    });
    return { ...result, calls, writes: calls.filter((call) => WRITES.includes(call)) };
  }

  it("posts the status and merges when every check passes or is skipped", () => {
    const { code, lines, writes } = gate({
      status: 0,
      out: "pass\tci\tcheck\nskipping\tci\tmerge-gate",
    });
    expect({ code, lines, writes }).toEqual({
      code: 0,
      lines: ["skipped: ci merge-gate", ""],
      writes: WRITES,
    });
  });

  it.each(["fail", "pending", "cancel"])(
    "refuses a %s check although gh pr checks --json exits 0, and writes nothing",
    (bucket) => {
      const { code, lines, writes } = gate({
        status: 0,
        out: `pass\tci\tcheck\n${bucket}\tci\te2e`,
      });
      expect({ code, lines, writes }).toEqual({
        code: 1,
        lines: [`${bucket}: ci e2e`, "merge-gate: checks are not all green"],
        writes: [],
      });
    },
  );

  it("refuses a pull request that has no checks, and writes nothing", () => {
    const { code, writes } = gate({ status: 1, out: "" });
    expect({ code, writes }).toEqual({ code: 1, writes: [] });
  });

  it("refuses a draft and a head that does not contain origin/main before it reads a check", () => {
    const pass = { status: 0, out: "pass\tci\tcheck" };
    const draft = gate(pass, `${HEAD_SHA}\ttrue`);
    const behind = gate(pass, undefined, 1);
    expect({
      lines: [draft.lines, behind.lines],
      readChecks: [...draft.calls, ...behind.calls].includes("gh pr checks"),
    }).toEqual({ lines: [["mark ready first"], ["rebase first"]], readChecks: false });
  });
});
