import { readFileSync } from "node:fs";
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

  it("ignores a later skipped run when an earlier run of the name concluded (the closed event, P-505)", () => {
    const closedEvent = [
      run("preview", "success", "completed", 7),
      run("preview", "skipped", "completed", 9),
      run("e2e", "failure", "completed", 6),
      run("e2e", "skipped", "completed", 8),
    ];
    expect(evaluate({ checkRuns: [...rest, ...closedEvent] }).lines).toEqual([
      `unverified merge ${SHA}: e2e failure`,
    ]);
    const onlySkipped = [
      ...rest,
      run("preview", "skipped", "completed", 9),
      run("e2e", "success", "completed", 8),
    ];
    expect(evaluate({ checkRuns: onlySkipped }).lines).toEqual([
      `unverified merge ${SHA}: preview skipped`,
    ]);
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
  const CI_SHOW = "git show origin/main:.github/workflows/ci.yml";
  const CI_TEXT = readFileSync(
    new URL("../../../.github/workflows/ci.yml", import.meta.url),
    "utf8",
  );
  // Measured with gh 2.92.0 on PR 23 (2026-10-02): stderr, exit 1.
  const NONE = { status: 1, err: "no checks reported on the 'chore/b1b-g5-records' branch" };
  const GREEN = { status: 0, out: "pass\tci\tcheck" };
  const DOCS = [
    ".claude/POSITION.md",
    "workspace/05-plans/B1b.md",
    "launch/film/notes.txt",
    "README.md",
    "app/docs/runbooks/delivery.md",
  ];

  interface Answer {
    status: number;
    out?: string;
    err?: string;
  }
  interface Stub {
    checks: Answer;
    view?: string;
    ancestor?: number;
    jobs?: Record<string, Answer>;
    ci?: Answer;
    files?: Answer;
    post?: Answer;
    merge?: Answer;
  }

  const JOB = (id: number) => `https://github.com/o/r/actions/runs/9/job/${String(id)}`;
  const steps = (...rows: [string, string][]) => ({
    status: 0,
    out: [["Set up job", "success"], ...rows, ["Complete job", "success"]]
      .map((row) => row.join("\t"))
      .join("\n"),
  });
  // What `gh pr view --json changedFiles,files --jq '.changedFiles, .files[].path'` prints.
  const listed = (paths: string[], count = paths.length) => ({
    status: 0,
    out: [String(count), ...paths].join("\n"),
  });

  function gate({
    checks,
    view = `${HEAD_SHA}\tfalse`,
    ancestor = 0,
    jobs = {},
    ci = { status: 0, out: CI_TEXT },
    files = listed(DOCS),
    post = { status: 0 },
    merge = { status: 0 },
  }: Stub) {
    const calls: string[] = [];
    const result = mergeGate("22", (command, args) => {
      const call = `${command} ${args.slice(0, 2).join(" ")}`;
      calls.push(call);
      const answer = (given: Answer) => ({ out: "", err: "", ...given });
      if (call === CI_SHOW) return answer(ci);
      if (command === "git") return answer({ status: args[0] === "merge-base" ? ancestor : 0 });
      if (call === "gh pr view") {
        return answer(args.includes("changedFiles,files") ? files : { status: 0, out: view });
      }
      if (call === "gh pr checks") return answer(checks);
      if (call === "gh api -X") return answer(post);
      if (call === "gh pr merge") return answer(merge);
      const job = /actions\/jobs\/([^/]+)$/.exec(args[1] ?? "")?.[1] ?? "";
      return answer(jobs[job] ?? { status: 1, err: "HTTP 404" });
    });
    return { ...result, calls, writes: calls.filter((call) => WRITES.includes(call)) };
  }

  it("posts the status and merges when every check passes or is skipped", () => {
    const { code, lines, writes } = gate({
      checks: { status: 0, out: "pass\tci\tcheck\nskipping\tci\tmerge-gate" },
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
        checks: { status: 0, out: `pass\tci\tcheck\n${bucket}\tci\te2e` },
      });
      expect({ code, lines, writes }).toEqual({
        code: 1,
        lines: [`${bucket}: ci e2e`, "merge-gate: checks are not all green"],
        writes: [],
      });
    },
  );

  it("refuses when the checks cannot be read, and writes nothing", () => {
    const { code, lines, writes } = gate({ checks: { status: 1, err: "HTTP 502: Bad Gateway" } });
    expect({ code, lines, writes }).toEqual({
      code: 1,
      lines: ["merge-gate: no checks to read (gh pr checks exit 1) HTTP 502: Bad Gateway"],
      writes: [],
    });
  });

  it("refuses a draft and a head that does not contain origin/main before it reads a check", () => {
    const draft = gate({ checks: GREEN, view: `${HEAD_SHA}\ttrue` });
    const behind = gate({ checks: GREEN, ancestor: 1 });
    expect({
      lines: [draft.lines, behind.lines],
      readChecks: [...draft.calls, ...behind.calls].includes("gh pr checks"),
    }).toEqual({ lines: [["mark ready first"], ["rebase first"]], readChecks: false });
  });

  it("prints a passed job whose steps were all skipped, and still merges", () => {
    const { code, lines, writes } = gate({
      checks: { status: 0, out: `pass\tci\tcheck\t${JOB(1)}\npass\tci\te2e\t${JOB(2)}` },
      jobs: {
        "1": steps(["engines", "success"], ["Run bun run check", "success"]),
        "2": steps(["engines", "skipped"], ["Run bun run build", "skipped"]),
      },
    });
    expect({ code, lines, writes }).toEqual({
      code: 0,
      lines: ["all steps skipped: ci e2e", ""],
      writes: WRITES,
    });
  });

  it("prints no job that ran a step, or that has no step but the runner's", () => {
    const { lines } = gate({
      checks: { status: 0, out: `pass\tci\tbuild\t${JOB(1)}\npass\tci\tdb\t${JOB(2)}` },
      jobs: {
        "1": steps(["engines", "success"], ["Run bun run build", "skipped"]),
        "2": steps(["Post Run actions/checkout", "skipped"]),
      },
    });
    expect(lines).toEqual([""]);
  });

  it("refuses when the steps of a passed job cannot be read, and writes nothing", () => {
    const { code, lines, writes } = gate({
      checks: { status: 0, out: `pass\tci\tcheck\t${JOB(3)}` },
    });
    expect({ code, lines, writes }).toEqual({
      code: 1,
      lines: ["merge-gate: cannot read the steps of ci check: HTTP 404"],
      writes: [],
    });
  });

  it("reads no steps for a check that is not a job of ours", () => {
    const { code, writes } = gate({
      checks: { status: 0, out: "pass\tcloudflare\tdeploy\thttps://example.com/deploy/1" },
    });
    expect({ code, writes }).toEqual({ code: 0, writes: WRITES });
  });

  it("refuses and merges nothing when posting the status fails", () => {
    const { code, lines, writes } = gate({ checks: GREEN, post: { status: 1, err: "HTTP 403" } });
    expect({ code, lines, writes }).toEqual({
      code: 1,
      lines: ["merge-gate: posting the status failed: HTTP 403"],
      writes: ["gh api -X"],
    });
  });

  it("exits 1 when gh pr merge fails", () => {
    const refused = "GraphQL: Head sha didn't match expected head sha (mergePullRequest)";
    const { code, lines, writes } = gate({ checks: GREEN, merge: { status: 1, err: refused } });
    expect({ code, lines, writes }).toEqual({ code: 1, lines: [refused], writes: WRITES });
  });

  describe("a pull request with no check (H42 (1))", () => {
    it("merges a documents-only pull request, read against ci.yml on origin/main", () => {
      const { code, lines, writes, calls } = gate({ checks: NONE });
      expect({ code, lines, writes, readCi: calls.includes(CI_SHOW) }).toEqual({
        code: 0,
        lines: ["documents only: no check expected", ""],
        writes: WRITES,
        readCi: true,
      });
    });

    it.each([
      "app/src/start.ts",
      ".claude/workflows/build-slice.js",
      "workspacex/a.txt",
      "app/a.mdx",
    ])("refuses a pull request with no check that changes %s", (path) => {
      const { code, lines, writes } = gate({ checks: NONE, files: listed([...DOCS, path]) });
      expect({ code, lines, writes }).toEqual({
        code: 1,
        lines: [`merge-gate: no checks reported and ${path} is not a document`],
        writes: [],
      });
    });

    it("refuses when ci.yml cannot be read on origin/main", () => {
      const missing = "fatal: path '.github/workflows/ci.yml' does not exist in 'origin/main'";
      const { lines, writes } = gate({ checks: NONE, ci: { status: 128, err: missing } });
      expect({ lines, writes }).toEqual({
        lines: [`merge-gate: no checks, and ci.yml cannot be read: ${missing}`],
        writes: [],
      });
    });

    it("refuses when paths-ignore holds a wildcard the gate does not read", () => {
      const out = CI_TEXT.replace('"launch/**"', '"launch/[ab]*/**"');
      const { lines, writes } = gate({ checks: NONE, ci: { status: 0, out } });
      expect({ lines, writes }).toEqual({
        lines: ["merge-gate: no checks, and the paths-ignore of ci.yml is unread"],
        writes: [],
      });
    });

    it("reads a single * as GitHub does: it matches no slash", () => {
      const out = CI_TEXT.replace('"launch/**"', '"launch/*"');
      const files = listed(["launch/notes.txt", "launch/film/x.ts"]);
      const { lines, writes } = gate({ checks: NONE, ci: { status: 0, out }, files });
      expect({ lines, writes }).toEqual({
        lines: ["merge-gate: no checks reported and launch/film/x.ts is not a document"],
        writes: [],
      });
    });

    it("refuses when gh lists fewer files than the pull request changes", () => {
      const { lines, writes } = gate({ checks: NONE, files: listed(DOCS, 101) });
      expect({ lines, writes }).toEqual({
        lines: ["merge-gate: no checks, and 5 of 101 changed files listed"],
        writes: [],
      });
    });

    it("refuses a pull request with no check and no changed file", () => {
      const { lines, writes } = gate({ checks: NONE, files: listed([]) });
      expect({ lines, writes }).toEqual({
        lines: ["merge-gate: no checks, and 0 of 0 changed files listed"],
        writes: [],
      });
    });

    it("refuses when the changed files cannot be read", () => {
      const { lines, writes } = gate({ checks: NONE, files: { status: 1, err: "HTTP 502" } });
      expect({ lines, writes }).toEqual({
        lines: ["merge-gate: cannot read the changed files: HTTP 502"],
        writes: [],
      });
    });
  });
});
