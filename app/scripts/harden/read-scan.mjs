// `node scripts/harden/read-scan.mjs <report.md> [--today YYYY-MM-DD]`
// H1-09's reader of the saved `claude-security:scan` report (`../workspace/audits/security-scan-YYYY-MM-DD.md`).
// The report carries a `date: YYYY-MM-DD` line and one `### <id> · <title>` heading per finding, with a
// `- severity: Critical|High|Medium|Low|Info` line and, under a Critical or High, a `- closed: <commit and file>` or
// `- accepted: <who, date, why>` line. Prints `scan ok <date>` and exits 0; exits 1 naming the problem when the report
// is missing, older than 7 days, or holds a Critical or High that is neither closed nor accepted in writing.
// `--today` fixes the reference day for the watched-fail fixtures.
import { existsSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";

const MAX_AGE_DAYS = 7;
const DAY_MS = 86_400_000;
const SEVERITIES = ["Critical", "High", "Medium", "Low", "Info"];
const BLOCKING = new Set(["Critical", "High"]);

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { today: { type: "string" } },
});
const [path = ""] = positionals;

/** @param {string} message */
function fail(message) {
  console.log(`scan fail: ${message}`);
  process.exit(1);
}

/** @param {string} day */
function dayMs(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) fail(`not a date: ${day}`);
  return Date.parse(`${day}T00:00:00Z`);
}

if (path === "" || !existsSync(path)) fail(`no report at "${path}"`);
const lines = readFileSync(path, "utf8").split(/\r?\n/);
const date = lines.map((line) => /^date: (\S+)$/.exec(line)?.[1]).find((d) => d !== undefined);
if (date === undefined) fail(`${path}: no "date: YYYY-MM-DD" line`);
const reportDate = /** @type {string} */ (date);
const today = values.today ?? new Date().toISOString().slice(0, 10);
const age = Math.floor((dayMs(today) - dayMs(reportDate)) / DAY_MS);
if (age > MAX_AGE_DAYS)
  fail(
    `${path}: report dated ${reportDate} is ${String(age)} days old (limit ${String(MAX_AGE_DAYS)})`,
  );

/** @type {{ title: string, line: number, severity?: string, written: boolean }[]} */
const findings = [];
lines.forEach((line, index) => {
  const heading = /^### (.+)$/.exec(line)?.[1];
  if (heading !== undefined) {
    findings.push({ title: heading.trim(), line: index + 1, written: false });
    return;
  }
  const current = findings.at(-1);
  if (current === undefined) return;
  const severity = /^- severity: (\S+)/.exec(line)?.[1];
  if (severity !== undefined) current.severity = severity;
  if (/^- (closed|accepted): \S/.test(line)) current.written = true;
});

const problems = findings.flatMap((finding) => {
  const where = `${path}:${String(finding.line)}: "${finding.title}"`;
  if (finding.severity === undefined || !SEVERITIES.includes(finding.severity)) {
    return [`${where} has no severity of ${SEVERITIES.join(", ")}`];
  }
  if (BLOCKING.has(finding.severity) && !finding.written) {
    return [`${where} is ${finding.severity} with no "- closed:" or "- accepted:" line`];
  }
  return [];
});
if (problems.length > 0) {
  for (const problem of problems) console.log(`scan fail: ${problem}`);
  process.exit(1);
}
const blocking = findings.filter((f) => BLOCKING.has(f.severity ?? "")).length;
console.log(
  `scan ok ${reportDate}: ${String(findings.length)} findings, ${String(blocking)} critical or high, each closed or accepted`,
);
