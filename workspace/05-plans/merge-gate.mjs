#!/usr/bin/env node
// The orchestrator's only merge path (B1b invariant 6b, STANDARDS R55, GOTCHAS P-028).
// usage: node workspace/05-plans/merge-gate.mjs <pr>
// In order: refuses a draft, a head that does not contain origin/main (unless main gained only
// documents since the head's merge base, which no check reads), and any check that is
// failed, pending or cancelled, and prints every job that passed with all its steps skipped; then
// posts the commit status merge-gate=success on the head and merges with a merge commit pinned
// to that head. A pull request with no check at all merges only when every changed path is in the
// paths-ignore of ci.yml on origin/main (ASSUMED H42 (1)). The post-merge ci job `merge-gate`
// (app/scripts/merge-gate.mjs) verifies the status and the required checks again, so a merge that
// skipped this script cannot deploy.
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = "AbdulrahmanAmer/matter-of-place";
const CI_YML = ".github/workflows/ci.yml";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * @typedef {{ status: number | null, out: string, err: string }} Result
 * @typedef {(command: string, args: string[]) => Result} Run
 */

/** @type {Run} */
function runHere(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8" });
  if (result.error) throw result.error;
  return {
    status: result.status,
    out: result.stdout.trim(),
    err: result.stderr.trim(),
  };
}

// The steps the runner adds to every job; a job passes "all skipped" when every other step did.
const BOOKKEEPING = /^(Set up job|Complete job|Post )/;

// What gh 2.92.0 writes to stderr, with exit 1, for a pull request no workflow ran on.
const NO_CHECKS = /^no checks reported/;

// ci.yml writes the patterns as one flow list of double-quoted strings; any other form is not
// read, so the gate refuses rather than guesses.
const PATHS_IGNORE =
  /^ {2}pull_request:\n(?: {4}.*\n)*? {4}paths-ignore: \[("[^"]*"(?:, "[^"]*")*)\]$/m;

const WILDCARDS = new Map([
  ["**/", "(?:.*/)?"],
  ["**", ".*"],
  ["*", "[^/]*"],
]);

/**
 * A GitHub filter pattern that uses only `**` and `*`, as a regular expression; any other special
 * character gives null.
 * @param {string} pattern
 * @returns {RegExp | null}
 */
function globToRegExp(pattern) {
  if (/[?[\]!+{}\\]/.test(pattern)) return null;
  const source = pattern
    .split(/(\*\*\/|\*\*|\*)/)
    .map((part) => WILDCARDS.get(part) ?? part.replace(/[.^$|()]/g, "\\$&"))
    .join("");
  return new RegExp(`^${source}$`);
}

/**
 * The `paths-ignore` patterns of the `pull_request` trigger, or null when they cannot be read.
 * @param {string} text
 * @returns {RegExp[] | null}
 */
function pathsIgnore(text) {
  const list = PATHS_IGNORE.exec(text)?.[1];
  if (list === undefined) return null;
  /** @type {RegExp[]} */
  const patterns = [];
  for (const [, pattern = ""] of list.matchAll(/"([^"]*)"/g)) {
    const regex = globToRegExp(pattern);
    if (regex === null) return null;
    patterns.push(regex);
  }
  return patterns;
}

/**
 * A pull request no workflow ran on (H42 (1)): every changed path must match a `paths-ignore`
 * pattern of ci.yml on origin/main, where the PR cannot have widened the list. `files` holds at
 * most 100 paths, so a list shorter than `changedFiles` is refused.
 * @param {string} pr
 * @param {Run} run
 * @returns {string} the refusal, or "" for documents only
 */
function documentsOnly(pr, run) {
  const ci = run("git", ["show", `origin/main:${CI_YML}`]);
  if (ci.status !== 0)
    return `merge-gate: no checks, and ci.yml cannot be read: ${ci.err}`;
  const patterns = pathsIgnore(ci.out);
  if (patterns === null)
    return "merge-gate: no checks, and the paths-ignore of ci.yml is unread";
  const files = run("gh", [
    "pr",
    "view",
    pr,
    "--json",
    "changedFiles,files",
    "--jq",
    ".changedFiles, .files[].path",
  ]);
  if (files.status !== 0)
    return `merge-gate: cannot read the changed files: ${files.err}`;
  const [count, ...paths] = files.out.split("\n");
  if (paths.length === 0 || String(paths.length) !== count) {
    return `merge-gate: no checks, and ${String(paths.length)} of ${count ?? ""} changed files listed`;
  }
  const other = paths.find(
    (path) => !patterns.some((pattern) => pattern.test(path)),
  );
  return other === undefined
    ? ""
    : `merge-gate: no checks reported and ${other} is not a document`;
}

/**
 * A head behind origin/main (ruling H65): every path main gained since the head's merge base must
 * match a `paths-ignore` pattern of ci.yml on origin/main, or the head carries a merge no check ran
 * on. Six lanes and the records pull requests move main every few minutes; a lane that re-merges
 * main for a GOTCHAS line restarts its whole CI clock for nothing.
 * @param {string} headSha
 * @param {Run} run
 * @returns {string} the refusal, or "" when main gained documents only
 */
function behindByDocumentsOnly(headSha, run) {
  const ci = run("git", ["show", `origin/main:${CI_YML}`]);
  if (ci.status !== 0) return "rebase first";
  const patterns = pathsIgnore(ci.out);
  if (patterns === null) return "rebase first";
  const base = run("git", ["merge-base", "origin/main", headSha]);
  if (base.status !== 0 || base.out === "") return "rebase first";
  const gained = run("git", ["diff", "--name-only", base.out, "origin/main"]);
  if (gained.status !== 0) return "rebase first";
  const paths = gained.out.split("\n").filter(Boolean);
  if (paths.length === 0) return "rebase first";
  const other = paths.find(
    (path) => !patterns.some((pattern) => pattern.test(path)),
  );
  return other === undefined ? "" : `rebase first (main gained ${other})`;
}

/**
 * @param {string} text
 * @returns {string[][]}
 */
function tsv(text) {
  return text
    .split("\n")
    .filter((row) => row !== "")
    .map((row) => row.split("\t"));
}

/**
 * The gate itself, with the commands injected so a test can watch which ones it runs.
 * `gh pr checks --json` exits 0 whatever the buckets are (the plain form exits 1 for a failure
 * and 8 for a pending check), so the verdict is read from the buckets: only `pass` and `skipping`
 * let a merge through. A job that passed with every step skipped looks like any other pass in
 * that list (DO-04), so the steps of each passed job are read and such a job is printed.
 * @param {string} pr
 * @param {Run} run
 * @returns {{ code: number, lines: string[] }}
 */
export function mergeGate(pr, run) {
  /** @type {string[]} */
  const lines = [];
  /** @param {string} message */
  const refuse = (message) => ({ code: 1, lines: [...lines, message] });

  const view = run("gh", [
    "pr",
    "view",
    pr,
    "--json",
    "headRefOid,isDraft",
    "--jq",
    "[.headRefOid, .isDraft] | @tsv",
  ]);
  if (view.status !== 0)
    return refuse(`merge-gate: cannot read pull request ${pr}: ${view.err}`);
  const [headSha = "", draft] = view.out.split("\t");
  if (draft === "true") return refuse("mark ready first");

  const fetched = run("git", [
    "fetch",
    "--quiet",
    "origin",
    "main",
    `pull/${pr}/head`,
  ]);
  if (fetched.status !== 0)
    return refuse(`merge-gate: git fetch failed: ${fetched.err}`);
  const ancestor = run("git", [
    "merge-base",
    "--is-ancestor",
    "origin/main",
    headSha,
  ]);
  if (ancestor.status === 1) {
    const refusal = behindByDocumentsOnly(headSha, run);
    if (refusal !== "") return refuse(refusal);
    lines.push(
      "behind main by documents only: no check reads them, proceeding",
    );
  } else if (ancestor.status !== 0) {
    return refuse(`merge-gate: git merge-base failed: ${ancestor.err}`);
  }

  const checks = run("gh", [
    "pr",
    "checks",
    pr,
    "--json",
    "bucket,workflow,name,link",
    "--jq",
    ".[] | [.bucket, .workflow, .name, .link] | @tsv",
  ]);
  const rows = tsv(checks.out);
  if (checks.status !== 0 && NO_CHECKS.test(checks.err)) {
    const refusal = documentsOnly(pr, run);
    if (refusal !== "") return refuse(refusal);
    lines.push("documents only: no check expected");
  } else if (checks.status !== 0 || rows.length === 0) {
    return refuse(
      `merge-gate: no checks to read (gh pr checks exit ${String(checks.status)}) ${checks.err}`.trim(),
    );
  }
  let blocked = false;
  for (const [bucket = "", workflow = "", name = "", link = ""] of rows) {
    if (bucket === "pass") {
      const jobId = /\/actions\/runs\/\d+\/job\/(\d+)/.exec(link)?.[1];
      if (jobId === undefined) continue;
      const steps = run("gh", [
        "api",
        `repos/${REPO}/actions/jobs/${jobId}`,
        "--jq",
        ".steps[] | [.name, .conclusion] | @tsv",
      ]);
      if (steps.status !== 0) {
        return refuse(
          `merge-gate: cannot read the steps of ${workflow} ${name}: ${steps.err}`,
        );
      }
      const work = tsv(steps.out).filter(
        ([step]) => !BOOKKEEPING.test(step ?? ""),
      );
      if (
        work.length > 0 &&
        work.every(([, conclusion]) => conclusion === "skipped")
      ) {
        lines.push(`all steps skipped: ${workflow} ${name}`);
      }
      continue;
    }
    lines.push(
      `${bucket === "skipping" ? "skipped" : bucket}: ${workflow} ${name}`,
    );
    if (bucket !== "skipping") blocked = true;
  }
  if (blocked) return refuse("merge-gate: checks are not all green");

  const status = run("gh", [
    "api",
    "-X",
    "POST",
    `repos/${REPO}/statuses/${headSha}`,
    "-f",
    "state=success",
    "-f",
    "context=merge-gate",
  ]);
  if (status.status !== 0)
    return refuse(`merge-gate: posting the status failed: ${status.err}`);

  const merge = run("gh", [
    "pr",
    "merge",
    pr,
    "--merge",
    "--match-head-commit",
    headSha,
  ]);
  lines.push(`${merge.out}${merge.err}`);
  return { code: merge.status === 0 ? 0 : 1, lines };
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const pr = process.argv[2];
  if (!/^\d+$/.test(pr ?? "")) {
    process.stdout.write(
      "usage: node workspace/05-plans/merge-gate.mjs <pr>\n",
    );
    process.exit(2);
  }
  const { code, lines } = mergeGate(pr ?? "", runHere);
  for (const line of lines) {
    process.stdout.write(`${line}\n`);
  }
  process.exit(code);
}
