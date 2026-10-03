import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseJsonOrNull } from "../../workspace/audits/tools/common.mjs";
import { SECRET_NAMES } from "../../workspace/audits/tools/run-all.mjs";

export const SECTIONS = [
  "Summary",
  "Scorecard",
  "Free-tier gauges",
  "KPIs",
  "Inquiries by source",
  "Analytics trend",
  "Not found (404)",
  "Findings",
  "Proposed changes",
  "Not measured",
];
export const SCORECARD_ROWS = [
  "Performance",
  "Technical SEO",
  "AEO and GEO",
  "Keywords",
  "Channels",
  "Security",
  "Uptime",
  "Caching",
];
const EFFORT = { S: 1, M: 2, L: 3 };
const SUMMARY_LINES = 5;
const MIN_SECRET_LENGTH = 8;
const EM_DASH = String.fromCodePoint(0x2014);

/** A pattern is named, never its match, when it is found. */
const SECRET_PATTERNS = [
  /\bmopk_[A-Za-z0-9_-]+/,
  /\bsk_[A-Za-z0-9]{8,}/,
  /Bearer [A-Za-z0-9._-]{8,}/,
  /-----BEGIN/,
];
const OPS_HEALTH_SEGMENT = /\/api\/hooks\/ops-health\/([^\s"'`)\]/?]+)/g;
const OPS_HEALTH_ALLOWED = ["<redacted>", "<OPS_HEALTH_TOKEN>"];

/**
 * @param {unknown} value
 * @param {Set<string>} into every number in the value, as the digits JSON would print
 * @returns {Set<string>}
 */
function collectNumbers(value, into) {
  if (typeof value === "number") into.add(normalise(value));
  else if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value))
    into.add(normalise(Number(value)));
  else if (Array.isArray(value)) for (const item of value) collectNumbers(item, into);
  else if (typeof value === "object" && value !== null) {
    for (const item of Object.values(value)) collectNumbers(item, into);
  }
  return into;
}

/**
 * @param {number} value
 * @returns {string}
 */
const normalise = (value) => String(Math.round(value * 1e6) / 1e6);

/**
 * The numbers a table cell shows: not dates, finding ids, URLs, code spans or digits that belong to a
 * word (`H16`, `p75`). A percent matches the sidecar as it is or as a share of one.
 * @param {string} line
 * @returns {{ token: string, candidates: string[] }[]}
 */
function numbersIn(line) {
  const text = line
    .replace(/`[^`]*`/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ")
    .replace(/\bA-\d{8}-\d{2}\b/g, " ");
  return [...text.matchAll(/(?<![\w./-])([-+]?)(\d+(?:,\d{3})*(?:\.\d+)?)(%?)(?!\w)/g)].map(
    (match) => {
      const value = Number(`${match[1] === "-" ? "-" : ""}${(match[2] ?? "").replaceAll(",", "")}`);
      return {
        token: match[0],
        candidates: [normalise(value), ...(match[3] === "%" ? [normalise(value / 100)] : [])],
      };
    },
  );
}

/**
 * @param {string} report
 * @returns {{ heading: string, lines: string[] }[]} the `## ` sections with their lines
 */
function splitSections(report) {
  /** @type {{ heading: string, lines: string[] }[]} */
  const sections = [];
  let fenced = false;
  for (const line of report.split("\n")) {
    if (line.startsWith("```")) fenced = !fenced;
    const heading = fenced ? null : /^## (.+?)\s*$/.exec(line)?.[1];
    if (heading !== null && heading !== undefined) sections.push({ heading, lines: [] });
    else sections.at(-1)?.lines.push(line);
  }
  return sections;
}

/**
 * @param {string} body
 * @param {string} where
 * @returns {string[]}
 */
function secretProblems(body, where) {
  /** @type {string[]} */
  const problems = [];
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(body))
      problems.push(`secret: the ${where} matches the pattern ${String(pattern)}`);
  }
  for (const match of body.matchAll(OPS_HEALTH_SEGMENT)) {
    if (!OPS_HEALTH_ALLOWED.includes(match[1] ?? "")) {
      problems.push(
        `secret: the ${where} holds an ops-health path segment other than <redacted> (DO-03)`,
      );
    }
  }
  return problems;
}

/**
 * Everything the plan's report format requires, as one sentence per problem; an empty list passes.
 * @param {{ report: string, sidecarText: string | null, env: Record<string, string | undefined> }} input
 * @returns {string[]}
 */
export function lintReport({ report, sidecarText, env }) {
  /** @type {string[]} */
  const problems = [];
  if (!/^# Audit \d{4}-\d{2}-\d{2}$/m.test(report))
    problems.push('missing the title line "# Audit YYYY-MM-DD"');

  const sections = splitSections(report);
  let last = -1;
  for (const name of SECTIONS) {
    const at = sections.findIndex((section) => section.heading === name);
    if (at < 0) problems.push(`missing section "## ${name}"`);
    else if (at < last) problems.push(`section "## ${name}" is out of order`);
    else last = at;
  }
  const lines = (/** @type {string} */ name) =>
    sections.find((section) => section.heading === name)?.lines ?? [];

  const summary = lines("Summary").filter((line) => line.trim() !== "");
  if (
    sections.some((section) => section.heading === "Summary") &&
    summary.length !== SUMMARY_LINES
  ) {
    problems.push(
      `the summary has ${String(summary.length)} lines, exactly ${String(SUMMARY_LINES)} are required`,
    );
  }

  const firstCells = lines("Scorecard")
    .filter((line) => line.startsWith("|"))
    .map((line) => (line.split("|")[1] ?? "").replaceAll("*", "").trim().toLowerCase());
  for (const row of SCORECARD_ROWS) {
    if (!firstCells.some((cell) => cell.startsWith(row.toLowerCase()))) {
      problems.push(`the Scorecard has no "${row}" row`);
    }
  }

  problems.push(...findingProblems(lines("Findings")));

  report.split("\n").forEach((line, index) => {
    if (line.includes(EM_DASH)) problems.push(`line ${String(index + 1)} holds an em dash`);
  });

  problems.push(...secretProblems(report, "report"));
  if (sidecarText === null) {
    problems.push("the sidecar workspace/audits/data/<date>.json is missing");
  } else {
    problems.push(...secretProblems(sidecarText, "sidecar"));
    problems.push(...numberProblems(report, sidecarText));
  }
  for (const name of SECRET_NAMES) {
    const value = env[name] ?? "";
    if (value.length < MIN_SECRET_LENGTH) continue;
    if (report.includes(value)) problems.push(`secret: the report holds the value of ${name}`);
    if (sidecarText?.includes(value) === true)
      problems.push(`secret: the sidecar holds the value of ${name}`);
  }
  return problems;
}

/**
 * @param {string[]} lines the lines of `## Findings`
 * @returns {string[]}
 */
function findingProblems(lines) {
  /** @type {string[]} */
  const problems = [];
  /** @type {{ id: string, score: number }[]} */
  const ranked = [];
  const blocks = lines.join("\n").split(/^### /m).slice(1);
  for (const block of blocks) {
    const id = /^(A-\d{8}-\d{2})\b/.exec(block)?.[1];
    if (id === undefined) {
      problems.push(
        `a finding heading does not start with an id A-YYYYMMDD-NN: "${block.split("\n")[0] ?? ""}"`,
      );
      continue;
    }
    const impact = Number(/^\W*Impact:\s*(\d)\b/im.exec(block)?.[1]);
    const effort = /^\W*Effort:\s*([SML])\b/im.exec(block)?.[1];
    const score = Number(/^\W*Score:\s*(\d+(?:\.\d+)?)\b/im.exec(block)?.[1]);
    if (!(impact >= 1 && impact <= 5) || effort === undefined || Number.isNaN(score)) {
      problems.push(`${id} is unranked: it needs Impact (1 to 5), Effort (S, M or L) and Score`);
      continue;
    }
    const expected = impact / EFFORT[/** @type {keyof typeof EFFORT} */ (effort)];
    if (Math.abs(score - expected) > 0.01) {
      problems.push(`${id} has Score ${String(score)}, impact / effort is ${expected.toFixed(2)}`);
    }
    ranked.push({ id, score });
  }
  ranked.forEach((finding, index) => {
    const before = ranked[index - 1];
    if (before !== undefined && finding.score > before.score) {
      problems.push(
        `findings are not ranked: ${finding.id} (${String(finding.score)}) follows ${before.id} (${String(before.score)})`,
      );
    }
  });
  return problems;
}

/**
 * Every number in a table cell of the report exists in the sidecar (invariant 5).
 * @param {string} report
 * @param {string} sidecarText
 * @returns {string[]}
 */
function numberProblems(report, sidecarText) {
  const sidecar = parseJsonOrNull(sidecarText);
  if (sidecar === null) return ["the sidecar is not valid JSON"];
  const known = collectNumbers(sidecar, new Set());
  /** @type {string[]} */
  const problems = [];
  let fenced = false;
  for (const line of report.split("\n")) {
    if (line.startsWith("```")) fenced = !fenced;
    if (fenced || !line.startsWith("|")) continue;
    for (const { token, candidates } of numbersIn(line)) {
      if (!candidates.some((candidate) => known.has(candidate))) {
        problems.push(
          `the number ${token} in a table is not in the sidecar: ${line.slice(0, 60).trim()}`,
        );
      }
    }
  }
  return problems;
}

/**
 * @param {string} reportPath
 * @returns {string[]}
 */
export function lintFile(reportPath) {
  const date = /(\d{4}-\d{2}-\d{2})\.md$/.exec(basename(reportPath))?.[1];
  if (date === undefined) return ["the report file name must be YYYY-MM-DD.md"];
  const sidecarPath = join(dirname(reportPath), "data", `${date}.json`);
  return lintReport({
    report: readFileSync(reportPath, "utf8"),
    sidecarText: existsSync(sidecarPath) ? readFileSync(sidecarPath, "utf8") : null,
    env: process.env,
  });
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const path = process.argv[2];
  const problems =
    path === undefined ? ["usage: node scripts/audit/lint-report.mjs <report.md>"] : lintFile(path);
  for (const problem of problems) process.stdout.write(`lint-report: ${problem}\n`);
  if (problems.length === 0) process.stdout.write(`lint-report: OK ${path ?? ""}\n`);
  process.exitCode = problems.length === 0 ? 0 : 1;
}
