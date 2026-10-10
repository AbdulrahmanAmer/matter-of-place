import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

// The findings ledger of the acceptance panel (plan H2): its schema, the severity rule, the report and the close-out
// arguments of a fix. `node workspace/05-plans/acceptance/run.mjs [--report] [--fix <id>] [--ledger <path>]`.
// Exit 0 when no row above `low` is open, 1 while one is, 2 when the ledger or the arguments are wrong.

export const SEVERITIES = ["critical", "high", "medium", "low"];
export const PANELISTS = ["senior-engineer", "security-specialist", "user-journey"];
export const STATUSES = ["question", "open", "fixing", "closed", "deferred"];
const ABOVE_LOW = SEVERITIES.slice(0, 3);
const OPEN_STATUSES = ["open", "fixing"];
const REQUIRED_TEXT = ["area", "title", "evidence"];
const OPTIONAL_TEXT = ["proof", "ruling", "slice", "steps", "fixGroup", "commit", "deferral"];
const KEYS = [
  "id",
  "panelist",
  "severity",
  "votes",
  "files",
  ...REQUIRED_TEXT,
  ...OPTIONAL_TEXT,
  "status",
];
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
export const LEDGER_PATH = fileURLToPath(new URL("ledger.json", import.meta.url));

/**
 * @typedef {{ panelist: string, severity: string, reason: string }} Vote
 * @typedef {{
 *   id: string, panelist: string, area: string, severity: string | null, votes: Vote[], ruling?: string,
 *   title: string, evidence: string, proof?: string, status: string, slice?: string, steps?: string,
 *   files?: string[], fixGroup?: string, commit?: string, deferral?: string,
 * }} Finding one row of the ledger
 */

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * @param {unknown} value
 * @returns {value is string}
 */
const isText = (value) => typeof value === "string" && value.trim() !== "";

/**
 * How many distinct panelists voted the agreed severity.
 * @param {{ severity?: unknown, votes?: unknown }} finding
 * @returns {number}
 */
export function agreeing(finding) {
  if (!Array.isArray(finding.votes)) return 0;
  const names = new Set();
  for (const vote of finding.votes) {
    if (isRecord(vote) && vote["severity"] === finding.severity) names.add(vote["panelist"]);
  }
  return names.size;
}

/**
 * What is wrong with one row, one sentence each. A `question` is a claim without a proof yet: it carries no severity.
 * Every other row has a proof, a severity two panelists voted (or an orchestrator ruling over a disagreement) and the
 * slice, steps and files a fix group needs.
 * @param {unknown} row
 * @returns {string[]}
 */
export function findingProblems(row) {
  if (!isRecord(row)) return ["not an object"];
  /** @type {string[]} */
  const problems = [];
  for (const key of Object.keys(row)) {
    if (!KEYS.includes(key)) problems.push(`unknown key ${key}`);
  }
  const text = (/** @type {string} */ key) => (typeof row[key] === "string" ? row[key].trim() : "");
  if (!/^F-\d{3,}$/.test(text("id"))) problems.push("id must look like F-012");
  if (!PANELISTS.includes(text("panelist")))
    problems.push(`panelist must be one of ${PANELISTS.join(", ")}`);
  for (const key of REQUIRED_TEXT) {
    if (text(key) === "") problems.push(`${key} is empty`);
  }
  const status = text("status");
  if (!STATUSES.includes(status)) {
    problems.push(`status must be one of ${STATUSES.join(", ")}`);
    return problems;
  }
  const votes = Array.isArray(row["votes"]) ? row["votes"] : [];
  if (row["votes"] !== undefined && !Array.isArray(row["votes"]))
    problems.push("votes must be a list");
  const voters = new Set();
  for (const vote of votes) {
    if (!isRecord(vote) || !PANELISTS.includes(String(vote["panelist"]))) {
      problems.push("a vote needs a panelist of the panel");
    } else if (voters.has(vote["panelist"])) {
      problems.push(`${String(vote["panelist"])} voted twice`);
    } else {
      voters.add(vote["panelist"]);
    }
    if (isRecord(vote) && !SEVERITIES.includes(String(vote["severity"]))) {
      problems.push("a vote needs a severity of critical, high, medium or low");
    }
    if (isRecord(vote) && !isText(vote["reason"])) problems.push("a vote needs its reason");
  }
  if (status === "question") {
    if (row["severity"] !== null && row["severity"] !== undefined) {
      problems.push("a question carries no severity until it has a proof");
    }
    return problems;
  }
  if (text("proof") === "") problems.push("a finding without a proof is a question");
  if (!SEVERITIES.includes(String(row["severity"]))) {
    problems.push("severity must be critical, high, medium or low");
  } else if (agreeing(row) < 2) {
    if (text("ruling") === "") {
      problems.push(
        `${String(agreeing(row))} panelist agrees on ${String(row["severity"])}: two must, or the disagreement is written with both reasons and the orchestrator's ruling`,
      );
    } else if (votes.length < 2) {
      problems.push("a ruling needs the votes of at least two panelists");
    }
  }
  for (const key of ["slice", "steps"]) {
    if (text(key) === "") problems.push(`${key} is empty: the fix group needs it`);
  }
  const files = row["files"];
  if (!Array.isArray(files) || files.length === 0 || !files.every(isText)) {
    problems.push("files must list the fix group's files");
  }
  if (["fixing", "closed"].includes(status) && text("fixGroup") === "") {
    problems.push(`${status} needs the fix group`);
  }
  if (status === "closed" && !/^[0-9a-f]{7,40}$/.test(text("commit"))) {
    problems.push("closed needs the merge commit");
  }
  if (status === "deferred" && text("deferral") === "")
    problems.push("deferred needs the operator's word");
  return problems;
}

/**
 * Every problem of a ledger file's content, prefixed with the row it belongs to.
 * @param {unknown} data
 * @returns {string[]}
 */
export function ledgerProblems(data) {
  if (!isRecord(data) || !Array.isArray(data["findings"]))
    return ['the file must be {"findings": [...]}'];
  /** @type {string[]} */
  const problems = [];
  const seen = new Set();
  data["findings"].forEach((row, index) => {
    const id =
      isRecord(row) && typeof row["id"] === "string" ? row["id"] : `row ${String(index + 1)}`;
    if (seen.has(id)) problems.push(`${id}: id used twice`);
    seen.add(id);
    for (const problem of findingProblems(row)) problems.push(`${id}: ${problem}`);
  });
  return problems;
}

/**
 * @param {Finding[]} findings
 * @returns {Finding[]} the rows that block the launch or the phase: above `low` and not closed, deferred or a question
 */
export function openAboveLow(findings) {
  return findings.filter(
    (finding) =>
      OPEN_STATUSES.includes(finding.status) && ABOVE_LOW.includes(String(finding.severity)),
  );
}

/**
 * @param {string} value
 * @returns {string}
 */
const cell = (value) => value.replaceAll("|", "/").replaceAll("\n", " ");

/**
 * The report: counts by severity and status, the open rows above `low` with the slice that owns each, every row.
 * @param {Finding[]} findings
 * @param {string} date YYYY-MM-DD
 * @returns {string}
 */
export function renderReport(findings, date) {
  const open = openAboveLow(findings);
  const lines = [
    `# Acceptance report ${date}`,
    "",
    `open above low: ${String(open.length)}`,
    `findings: ${String(findings.length)}`,
    "",
    "## Counts",
    "",
    `| severity | ${STATUSES.join(" | ")} |`,
    `| --- | ${STATUSES.map(() => "---").join(" | ")} |`,
    ...SEVERITIES.map(
      (severity) =>
        `| ${severity} | ${STATUSES.map((status) => String(findings.filter((f) => f.severity === severity && f.status === status).length)).join(" | ")} |`,
    ),
    `| no severity | ${STATUSES.map((status) => String(findings.filter((f) => f.severity === null && f.status === status).length)).join(" | ")} |`,
    "",
    "## Open above low",
    "",
  ];
  if (open.length === 0) {
    lines.push("None.");
  } else {
    lines.push(
      "| id | severity | area | title | slice | fix group |",
      "| --- | --- | --- | --- | --- | --- |",
    );
    for (const f of open) {
      lines.push(
        `| ${f.id} | ${String(f.severity)} | ${cell(f.area)} | ${cell(f.title)} | ${f.slice ?? ""} | ${f.fixGroup ?? "unassigned"} |`,
      );
    }
  }
  lines.push("", "## Findings", "");
  if (findings.length === 0) {
    lines.push("None recorded.");
  } else {
    lines.push(
      "| id | severity | status | panelist | area | title | proof |",
      "| --- | --- | --- | --- | --- | --- | --- |",
    );
    for (const f of findings) {
      lines.push(
        `| ${f.id} | ${f.severity ?? "none"} | ${f.status} | ${f.panelist} | ${cell(f.area)} | ${cell(f.title)} | ${cell(f.proof ?? "")} |`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

/**
 * The arguments of a `build-slice.js` run that closes one finding on the slice that owns it.
 * @param {Finding} finding
 * @returns {{ slice: string, only: string[], closeOut: Record<string, unknown> }}
 */
export function fixArguments(finding) {
  const id = finding.fixGroup ?? `h2-${finding.id.toLowerCase()}`;
  return {
    slice: String(finding.slice),
    only: [id],
    closeOut: {
      id,
      steps: String(finding.steps),
      title: finding.title,
      critical: finding.severity === "critical",
      source: `H2:${finding.id}`,
      defects: [
        {
          file: (finding.files ?? []).join(", "),
          what: finding.title,
          evidence: `${finding.evidence}\nproof: ${finding.proof ?? ""}`,
          blocking: true,
        },
      ],
    },
  };
}

/** @returns {number} */
function main() {
  const { values } = parseArgs({
    options: {
      report: { type: "boolean" },
      fix: { type: "string" },
      ledger: { type: "string", default: LEDGER_PATH },
    },
  });
  /** @type {unknown} */
  let data;
  try {
    data = JSON.parse(readFileSync(values.ledger ?? LEDGER_PATH, "utf8"));
  } catch (error) {
    console.error(`ledger: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
  const problems = ledgerProblems(data);
  if (problems.length > 0) {
    for (const problem of problems) console.error(problem);
    return 2;
  }
  const findings = /** @type {Finding[]} */ (/** @type {{ findings: unknown }} */ (data).findings);
  if (values.fix !== undefined) {
    const finding = findings.find((f) => f.id === values.fix);
    if (finding === undefined || finding.status === "question") {
      console.error(`${values.fix}: no such finding, or still a question`);
      return 2;
    }
    console.log(JSON.stringify(fixArguments(finding), null, 2));
    return 0;
  }
  const open = openAboveLow(findings);
  console.log(`open above low: ${String(open.length)}`);
  for (const f of open) console.log(`  ${f.id} ${String(f.severity)} ${f.title}`);
  if (values.report === true) {
    const date = new Date().toISOString().slice(0, 10);
    const path = join(REPO_ROOT, "workspace/audits", `acceptance-${date}.md`);
    writeFileSync(path, renderReport(findings, date));
    console.log(`report: ${path}`);
  }
  return open.length === 0 ? 0 : 1;
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = main();
}
