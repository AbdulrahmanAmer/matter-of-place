import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  agreeing,
  findingProblems,
  fixArguments,
  ledgerProblems,
  openAboveLow,
  renderReport,
} from "../../../workspace/05-plans/acceptance/run.mjs";
import type { Finding } from "../../../workspace/05-plans/acceptance/run.mjs";

// H2 step 1: the findings ledger of the acceptance panel, its severity rule and what is made of it.
const RUN = fileURLToPath(
  new URL("../../../workspace/05-plans/acceptance/run.mjs", import.meta.url),
);
const LEDGER = fileURLToPath(
  new URL("../../../workspace/05-plans/acceptance/ledger.json", import.meta.url),
);

const agree = (panelist: string, severity: string) => ({
  panelist,
  severity,
  reason: `${panelist} reads ${severity}`,
});

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "F-001",
    panelist: "security-specialist",
    area: "database",
    severity: "high",
    votes: [agree("security-specialist", "high"), agree("senior-engineer", "high")],
    title: "A table is readable by anon",
    evidence: "select returns 3 rows as anon",
    proof: "bun run db:psql -- -f q.sql",
    status: "open",
    slice: "B7",
    steps: "3",
    files: ["supabase/migrations/x.sql"],
    ...overrides,
  };
}

describe("the severity rule", () => {
  it("refuses a finding with one agreeing panelist", () => {
    const row = finding({
      votes: [agree("security-specialist", "high"), agree("senior-engineer", "low")],
    });
    expect(agreeing(row)).toBe(1);
    expect(findingProblems(row).join("\n")).toMatch(/1 panelist agrees on high/);
  });

  it("accepts two agreeing panelists and counts one panelist once", () => {
    expect(findingProblems(finding())).toEqual([]);
    const twice = finding({
      votes: [agree("security-specialist", "high"), agree("security-specialist", "high")],
    });
    expect(agreeing(twice)).toBe(1);
    expect(findingProblems(twice).join("\n")).toMatch(/voted twice/);
  });

  it("accepts a disagreement only with the orchestrator's ruling and both votes", () => {
    const split = {
      severity: "medium",
      votes: [agree("security-specialist", "high"), agree("user-journey", "low")],
    };
    expect(findingProblems(finding(split)).join("\n")).toMatch(/0 panelist agrees on medium/);
    expect(findingProblems(finding({ ...split, ruling: "medium: the journey completes" }))).toEqual(
      [],
    );
    const alone = finding({
      ...split,
      votes: [agree("security-specialist", "high")],
      ruling: "medium",
    });
    expect(findingProblems(alone).join("\n")).toMatch(/at least two panelists/);
  });
});

describe("a row's proof and fix group", () => {
  it("makes a finding without a proof a question that carries no severity", () => {
    expect(findingProblems(finding({ proof: "" })).join("\n")).toMatch(/question/);
    const question = finding({ status: "question", severity: null, votes: [], proof: "" });
    expect(findingProblems(question)).toEqual([]);
    expect(findingProblems({ ...question, severity: "high" }).join("\n")).toMatch(/no severity/);
  });

  it("needs the slice, the steps and the files of a fix group", () => {
    const problems = findingProblems(finding({ slice: "", steps: "", files: [] })).join("\n");
    expect(problems).toMatch(/slice is empty/);
    expect(problems).toMatch(/steps is empty/);
    expect(problems).toMatch(/files must list/);
  });

  it("closes a row only with a fix group and a merge commit, defers it only with a word", () => {
    expect(findingProblems(finding({ status: "closed" })).join("\n")).toMatch(
      /closed needs the fix group[\s\S]*closed needs the merge commit/,
    );
    expect(
      findingProblems(finding({ status: "closed", fixGroup: "c4", commit: "a1b2c3d" })),
    ).toEqual([]);
    expect(findingProblems(finding({ status: "deferred" })).join("\n")).toMatch(/operator's word/);
  });

  it("names a row's id in the ledger's problems and refuses an id used twice", () => {
    const rows = [finding(), finding({ title: "" })];
    const problems = ledgerProblems({ findings: rows }).join("\n");
    expect(problems).toMatch(/F-001: id used twice/);
    expect(problems).toMatch(/F-001: title is empty/);
    expect(ledgerProblems({ findings: "none" })).toHaveLength(1);
  });
});

describe("what the ledger yields", () => {
  const rows = [
    finding({ id: "F-001", severity: "critical" }),
    finding({ id: "F-002", severity: "low" }),
    finding({ id: "F-003", severity: "medium", status: "fixing", fixGroup: "c9" }),
    finding({ id: "F-004", status: "closed", fixGroup: "c4", commit: "a1b2c3d" }),
    finding({ id: "F-005", status: "deferred", deferral: "operator, after launch" }),
    finding({ id: "F-006", status: "question", severity: null, votes: [], proof: "" }),
  ];

  it("counts a row open above low only while it is open or being fixed", () => {
    expect(openAboveLow(rows).map((row) => row.id)).toEqual(["F-001", "F-003"]);
  });

  it("writes the report with the slice that owns each open row", () => {
    const report = renderReport(rows, "2026-10-11");
    expect(report).toContain("open above low: 2");
    expect(report).toContain(
      "| F-001 | critical | database | A table is readable by anon | B7 | unassigned |",
    );
    expect(report).toContain(
      "| F-003 | medium | database | A table is readable by anon | B7 | c9 |",
    );
    expect(renderReport([], "2026-10-11")).toContain("open above low: 0");
  });

  it("prints the close-out of a finding as build-slice.js takes it", () => {
    const args = fixArguments(finding({ severity: "critical" }));
    expect(args).toEqual({
      slice: "B7",
      only: ["h2-f-001"],
      closeOut: {
        id: "h2-f-001",
        steps: "3",
        title: "A table is readable by anon",
        critical: true,
        source: "H2:F-001",
        defects: [
          {
            file: "supabase/migrations/x.sql",
            what: "A table is readable by anon",
            evidence: "select returns 3 rows as anon\nproof: bun run db:psql -- -f q.sql",
            blocking: true,
          },
        ],
      },
    });
  });
});

describe("run.mjs on the command line", () => {
  const run = (rows: unknown[], ...args: string[]) => {
    const path = join(mkdtempSync(join(tmpdir(), "ledger-")), "ledger.json");
    writeFileSync(path, JSON.stringify({ findings: rows }));
    return spawnSync(process.execPath, [RUN, "--ledger", path, ...args], { encoding: "utf8" });
  };

  it("exits 0 on an empty ledger and 1 while a row above low is open", () => {
    expect(run([]).status).toBe(0);
    const blocked = run([finding()]);
    expect(blocked.status).toBe(1);
    expect(blocked.stdout).toContain("F-001 high A table is readable by anon");
    expect(
      run([
        finding({
          severity: "low",
          votes: [agree("user-journey", "low"), agree("senior-engineer", "low")],
        }),
      ]).status,
    ).toBe(0);
  });

  it("exits 2 on a ledger the schema refuses", () => {
    const refused = run([finding({ votes: [agree("security-specialist", "high")] })]);
    expect(refused.status).toBe(2);
    expect(refused.stderr).toContain("F-001:");
  });

  it("prints the close-out of --fix and refuses an unknown id or a question", () => {
    const fixed = run([finding()], "--fix", "F-001");
    expect(fixed.status).toBe(0);
    expect(JSON.parse(fixed.stdout)).toMatchObject({ slice: "B7", only: ["h2-f-001"] });
    expect(run([finding()], "--fix", "F-009").status).toBe(2);
    const question = finding({ status: "question", severity: null, votes: [], proof: "" });
    expect(run([question], "--fix", "F-001").status).toBe(2);
  });

  it("holds a ledger.json on disk that the schema accepts", () => {
    const data: unknown = JSON.parse(readFileSync(LEDGER, "utf8"));
    expect(ledgerProblems(data)).toEqual([]);
  });
});
