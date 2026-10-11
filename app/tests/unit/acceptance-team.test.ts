import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ledgerProblems } from "../../../workspace/05-plans/acceptance/run.mjs";
import type { Finding } from "../../../workspace/05-plans/acceptance/run.mjs";
import {
  applyTurn,
  passIsClean,
  runPass,
  stopRuleMet,
  turnPrompt,
} from "../../../workspace/05-plans/acceptance/team.mjs";
import type { Send, Turn } from "../../../workspace/05-plans/acceptance/team.mjs";

// H2 step 3: the team loop of the acceptance panel. The panelists are fakes; the rows, the votes, the log and the
// stop rule are the real code.
const NEW = { allowNew: true };

const raw = (overrides: Record<string, unknown> = {}) => ({
  area: "caching",
  title: "The home page misses the cache twice in a row",
  evidence: "x-mop-cache: miss on two requests",
  proof: "node workspace/05-plans/acceptance/probe.mjs page /",
  severity: "medium",
  reason: "a warm read must be a hit",
  slice: "B7",
  steps: "4",
  files: ["app/src/server/lib/cache.ts"],
  ...overrides,
});

const turn = (overrides: Partial<Turn> = {}): Turn => ({
  message: "",
  findings: [],
  votes: [],
  unwalked: [],
  done: false,
  ...overrides,
});

const vote = (id: string, severity: string) => ({ id, severity, reason: `reads ${severity}` });

const withRow = (): Finding[] => {
  const findings: Finding[] = [];
  applyTurn(findings, "senior-engineer", turn({ findings: [raw()] }), NEW);
  return findings;
};

describe("the two of three rule in the team loop", () => {
  it("keeps a proven finding a question until a second panelist votes the same severity", () => {
    const findings = withRow();
    expect(findings[0]).toMatchObject({ id: "F-001", status: "question", severity: null });
    expect(findings[0]?.votes).toHaveLength(1);
    applyTurn(findings, "user-journey", turn({ votes: [vote("F-001", "low")] }), NEW);
    expect(findings[0]).toMatchObject({ status: "question", severity: null });
    applyTurn(findings, "security-specialist", turn({ votes: [vote("F-001", "medium")] }), NEW);
    expect(findings[0]).toMatchObject({ status: "open", severity: "medium" });
    expect(ledgerProblems({ findings })).toEqual([]);
  });

  it("leaves three votes with no two alike for the orchestrator", () => {
    const findings = withRow();
    applyTurn(findings, "user-journey", turn({ votes: [vote("F-001", "low")] }), NEW);
    const { events } = applyTurn(
      findings,
      "security-specialist",
      turn({ votes: [vote("F-001", "high")] }),
      NEW,
    );
    expect(findings[0]).toMatchObject({ status: "question", severity: null });
    expect(events.join("\n")).toMatch(/F-001 NEEDS THE ORCHESTRATOR'S RULING/);
  });

  it("counts a panelist once and refuses a vote on a decided row", () => {
    const findings = withRow();
    const twice = applyTurn(
      findings,
      "senior-engineer",
      turn({ votes: [vote("F-001", "medium")] }),
      NEW,
    );
    expect(twice.notes.join("\n")).toMatch(/you voted already/);
    applyTurn(findings, "user-journey", turn({ votes: [vote("F-001", "medium")] }), NEW);
    const late = applyTurn(
      findings,
      "security-specialist",
      turn({ votes: [vote("F-001", "low")] }),
      NEW,
    );
    expect(late.notes.join("\n")).toMatch(/it is decided/);
    expect(findings[0]?.votes).toHaveLength(2);
  });
});

describe("what a panelist may hand in", () => {
  it("refuses a row that cannot become a fix group and keeps a proofless claim a question", () => {
    const findings: Finding[] = [];
    const bad = applyTurn(
      findings,
      "security-specialist",
      turn({ findings: [raw({ slice: "", files: [] })] }),
      NEW,
    );
    expect(findings).toEqual([]);
    expect(bad.notes.join("\n")).toMatch(/slice must be the id of the slice[\s\S]*files must list/);
    applyTurn(findings, "security-specialist", turn({ findings: [raw({ proof: "" })] }), NEW);
    expect(findings[0]).toMatchObject({ status: "question", severity: null, votes: [] });
    expect(ledgerProblems({ findings })).toEqual([]);
    const ignored = applyTurn(
      findings,
      "user-journey",
      turn({ votes: [vote("F-001", "low")] }),
      NEW,
    );
    expect(ignored.notes.join("\n")).toMatch(/F-001 ignored: it has no proof yet/);
  });

  it("numbers rows after the highest id and takes no new row when the round forbids it", () => {
    const findings = withRow();
    applyTurn(findings, "user-journey", turn({ findings: [raw({ title: "Second" })] }), NEW);
    expect(findings.map((f) => f.id)).toEqual(["F-001", "F-002"]);
    const refused = applyTurn(findings, "user-journey", turn({ findings: [raw()] }), {
      allowNew: false,
    });
    expect(findings).toHaveLength(2);
    expect(refused.notes.join("\n")).toMatch(/takes votes and answers only/);
  });
});

describe("a pass and its stop rule", () => {
  it("calls a pass clean only when nothing above low is open or voted above low", () => {
    const findings = withRow();
    expect(passIsClean(findings, 0)).toBe(false);
    expect(passIsClean(findings, 1)).toBe(true);
    const low: Finding[] = [];
    applyTurn(low, "senior-engineer", turn({ findings: [raw({ severity: "low" })] }), NEW);
    applyTurn(low, "user-journey", turn({ votes: [vote("F-001", "low")] }), NEW);
    expect(passIsClean(low, 0)).toBe(true);
  });

  it("stops after two clean numbered passes on different days", () => {
    const line = (pass: string, date: string, verdict: string) =>
      `pass-verdict: ${pass} ${date} ${verdict}\n`;
    expect(stopRuleMet(line("1", "2026-10-12", "clean") + line("2", "2026-10-13", "clean"))).toBe(
      true,
    );
    expect(stopRuleMet(line("1", "2026-10-12", "clean") + line("2", "2026-10-12", "clean"))).toBe(
      false,
    );
    expect(
      stopRuleMet(line("1", "2026-10-12", "clean") + line("2", "2026-10-13", "not-clean")),
    ).toBe(false);
    expect(
      stopRuleMet(line("1", "2026-10-12", "clean") + line("smoke", "2026-10-13", "clean")),
    ).toBe(false);
    expect(stopRuleMet("")).toBe(false);
  });
});

describe("the message loop", () => {
  it("shows each panelist the others' messages and the rows waiting for its vote", () => {
    const prompt = turnPrompt({
      panelist: "user-journey",
      round: 2,
      pass: "1",
      charter: "CHARTER TEXT",
      task: "Walk.",
      findings: withRow(),
      inbox: ["senior-engineer: check the cache header on /contact"],
      notes: ["vote on F-009 ignored: no such row"],
      deployed: "the deploy",
      allowNew: true,
    });
    expect(prompt).toContain("senior-engineer: check the cache header on /contact");
    expect(prompt).toContain("Rows waiting for your vote: F-001.");
    expect(prompt).toContain("vote on F-009 ignored");
    expect(prompt).not.toContain("CHARTER TEXT");
    const first = turnPrompt({
      panelist: "user-journey",
      round: 1,
      pass: "1",
      charter: "CHARTER TEXT",
      task: "Walk.",
      findings: [],
      inbox: [],
      notes: [],
      deployed: "the deploy",
      allowNew: true,
    });
    expect(first).toContain("CHARTER TEXT");
    expect(first).toContain("You do not write the ledger");
  });

  it("relays three panelists answering each other to the log and keeps the ledger valid", async () => {
    const dir = mkdtempSync(join(tmpdir(), "team-"));
    const ledgerPath = join(dir, "ledger.json");
    const logPath = join(dir, "log.md");
    writeFileSync(ledgerPath, JSON.stringify({ findings: [] }));
    writeFileSync(logPath, "");
    const seen: string[] = [];
    const send: Send = (panelist, prompt) => {
      seen.push(prompt);
      const first = panelist === "senior-engineer";
      const round1 = !prompt.includes("round 2");
      const answer = round1
        ? turn({
            message: `${panelist} read its page`,
            findings: first ? [raw()] : [],
            done: false,
          })
        : turn({
            message: `${panelist} answers the others`,
            votes: first ? [] : [vote("F-001", "medium")],
            done: true,
          });
      return Promise.resolve({ turn: answer, costUsd: 0.5 });
    };
    const tasks = Object.fromEntries(
      ["senior-engineer", "security-specialist", "user-journey"].map((n) => [n, "task"]),
    );
    const result = await runPass({
      pass: "smoke",
      send,
      charters: {},
      ledgerPath,
      logPath,
      maxRounds: 2,
      now: () => new Date("2026-10-11T10:00:00Z"),
      deployed: "the deploy",
      tasks,
      smoke: true,
    });
    const log = readFileSync(logPath, "utf8");
    expect(log).toMatch(
      /round 2 · security-specialist[\s\S]*security-specialist answers the others/,
    );
    expect(log).toContain("F-001 decided medium, now open");
    expect(log).toMatch(/^pass-verdict: smoke 2026-10-11 not-clean$/m);
    expect(seen[3]).toContain("security-specialist: security-specialist read its page");
    expect(seen[3]).not.toContain("senior-engineer: senior-engineer read its page");
    expect(result).toMatchObject({ rounds: 2, added: 1, costUsd: 3 });
    const ledger: unknown = JSON.parse(readFileSync(ledgerPath, "utf8"));
    expect(ledgerProblems(ledger)).toEqual([]);
  });

  const fresh = (smoke: boolean, maxRounds: number, send: Send) => {
    const dir = mkdtempSync(join(tmpdir(), "team-"));
    const ledgerPath = join(dir, "ledger.json");
    const logPath = join(dir, "log.md");
    writeFileSync(ledgerPath, JSON.stringify({ findings: [] }));
    writeFileSync(logPath, "");
    const tasks = Object.fromEntries(
      ["senior-engineer", "security-specialist", "user-journey"].map((n) => [n, "task"]),
    );
    const run = () =>
      runPass({
        pass: smoke ? "smoke" : "1",
        send,
        charters: {},
        ledgerPath,
        logPath,
        maxRounds,
        now: () => new Date("2026-10-11T10:00:00Z"),
        deployed: "the deploy",
        tasks,
        smoke,
      });
    return { run, logPath, ledgerPath };
  };

  it("asks a panelist to correct a refused row once, in the same round", async () => {
    const prompts: string[] = [];
    const send: Send = (panelist, prompt) => {
      prompts.push(prompt);
      const corrected = prompt.includes("The script took part of your last turn");
      const findings =
        panelist === "senior-engineer"
          ? [raw({ slice: corrected ? "B3" : "B3 (public cache)" })]
          : [];
      return Promise.resolve({ turn: turn({ findings, done: true }), costUsd: 0 });
    };
    const { run, logPath, ledgerPath } = fresh(false, 1, send);
    await run();
    const ledger: unknown = JSON.parse(readFileSync(ledgerPath, "utf8"));
    expect(ledger).toMatchObject({ findings: [{ id: "F-001", slice: "B3" }] });
    expect(prompts.filter((p) => p.includes("The script took part"))).toHaveLength(1);
    expect(prompts[1]).toContain('got "B3 (public cache)"');
    expect(readFileSync(logPath, "utf8")).toContain("round 1 · senior-engineer (correction)");
  });

  it("ends a numbered pass when all three are done and records its verdict", async () => {
    const send: Send = () => Promise.resolve({ turn: turn({ done: true }), costUsd: 0 });
    const { run, logPath } = fresh(false, 5, send);
    expect(await run()).toMatchObject({ rounds: 1, clean: true, added: 0 });
    expect(readFileSync(logPath, "utf8")).toMatch(/^pass-verdict: 1 2026-10-11 clean$/m);
  });
});
