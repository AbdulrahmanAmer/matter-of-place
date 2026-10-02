#!/usr/bin/env node
// The orchestrator's only merge path (B1b invariant 6b, STANDARDS R55, GOTCHAS P-028).
// usage: node workspace/05-plans/merge-gate.mjs <pr>
// In order: refuses a draft, a head that does not contain origin/main, and any check that is
// failed, pending or cancelled; then posts the commit status merge-gate=success on the head and
// merges with a merge commit pinned to that head. The post-merge ci job `merge-gate`
// (app/scripts/merge-gate.mjs) verifies the status and the required checks again, so a merge that
// skipped this script cannot deploy.
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = "AbdulrahmanAmer/matter-of-place";
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

/**
 * The gate itself, with the commands injected so a test can watch which ones it runs.
 * `gh pr checks --json` exits 0 whatever the buckets are (the plain form exits 1 for a failure
 * and 8 for a pending check), so the verdict is read from the buckets: only `pass` and `skipping`
 * let a merge through.
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
  if (view.status !== 0) return refuse(`merge-gate: cannot read pull request ${pr}: ${view.err}`);
  const [headSha = "", draft] = view.out.split("\t");
  if (draft === "true") return refuse("mark ready first");

  const fetched = run("git", ["fetch", "--quiet", "origin", "main", `pull/${pr}/head`]);
  if (fetched.status !== 0) return refuse(`merge-gate: git fetch failed: ${fetched.err}`);
  const ancestor = run("git", ["merge-base", "--is-ancestor", "origin/main", headSha]);
  if (ancestor.status === 1) return refuse("rebase first");
  if (ancestor.status !== 0) return refuse(`merge-gate: git merge-base failed: ${ancestor.err}`);

  const checks = run("gh", [
    "pr",
    "checks",
    pr,
    "--json",
    "bucket,workflow,name",
    "--jq",
    ".[] | [.bucket, .workflow, .name] | @tsv",
  ]);
  const rows = checks.out
    .split("\n")
    .filter((row) => row !== "")
    .map((row) => row.split("\t"));
  if (checks.status !== 0 || rows.length === 0) {
    return refuse(
      `merge-gate: no checks to read (gh pr checks exit ${checks.status}) ${checks.err}`.trim(),
    );
  }
  let blocked = false;
  for (const [bucket, workflow, name] of rows) {
    if (bucket === "pass") continue;
    lines.push(`${bucket === "skipping" ? "skipped" : String(bucket)}: ${workflow} ${name}`);
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
  if (status.status !== 0) return refuse(`merge-gate: posting the status failed: ${status.err}`);

  const merge = run("gh", ["pr", "merge", pr, "--merge", "--match-head-commit", headSha]);
  lines.push(`${merge.out}${merge.err}`);
  return { code: merge.status === 0 ? 0 : 1, lines };
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const pr = process.argv[2];
  if (!/^\d+$/.test(pr ?? "")) {
    process.stdout.write("usage: node workspace/05-plans/merge-gate.mjs <pr>\n");
    process.exit(2);
  }
  const { code, lines } = mergeGate(pr ?? "", runHere);
  for (const line of lines) {
    process.stdout.write(`${line}\n`);
  }
  process.exit(code);
}
