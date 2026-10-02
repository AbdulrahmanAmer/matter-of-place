#!/usr/bin/env node
// The orchestrator's only merge path (B1b invariant 6b, STANDARDS R55, GOTCHAS P-028).
// usage: node workspace/05-plans/merge-gate.mjs <pr>
// In order: refuses a draft, a head that does not contain origin/main, and any failed or pending
// check; then posts the commit status merge-gate=success on the head and merges with a merge
// commit pinned to that head. The post-merge ci job `merge-gate` (app/scripts/merge-gate.mjs)
// verifies the status and the required checks again, so a merge that skipped this script cannot
// deploy.
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = "AbdulrahmanAmer/matter-of-place";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8" });
  if (result.error) throw result.error;
  return {
    status: result.status,
    out: result.stdout.trim(),
    err: result.stderr.trim(),
  };
}

function refuse(message) {
  process.stdout.write(`${message}\n`);
  process.exit(1);
}

const pr = process.argv[2];
if (!/^\d+$/.test(pr ?? "")) {
  process.stdout.write("usage: node workspace/05-plans/merge-gate.mjs <pr>\n");
  process.exit(2);
}

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
  refuse(`merge-gate: cannot read pull request ${pr}: ${view.err}`);
const [headSha, draft] = view.out.split("\t");
if (draft === "true") refuse("mark ready first");

const fetched = run("git", [
  "fetch",
  "--quiet",
  "origin",
  "main",
  `pull/${pr}/head`,
]);
if (fetched.status !== 0)
  refuse(`merge-gate: git fetch failed: ${fetched.err}`);
const ancestor = run("git", [
  "merge-base",
  "--is-ancestor",
  "origin/main",
  headSha,
]);
if (ancestor.status === 1) refuse("rebase first");
if (ancestor.status !== 0)
  refuse(`merge-gate: git merge-base failed: ${ancestor.err}`);

const checks = run("gh", [
  "pr",
  "checks",
  pr,
  "--json",
  "bucket,workflow,name",
  "--jq",
  ".[] | [.bucket, .workflow, .name] | @tsv",
]);
for (const line of checks.out.split("\n").filter((row) => row !== "")) {
  const [bucket, workflow, name] = line.split("\t");
  if (bucket === "skipping")
    process.stdout.write(`skipped: ${workflow} ${name}\n`);
  else if (bucket !== "pass")
    process.stdout.write(`${bucket}: ${workflow} ${name}\n`);
}
if (checks.status !== 0)
  refuse(
    `merge-gate: checks are not all green (gh pr checks exit ${checks.status}) ${checks.err}`.trim(),
  );

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
  refuse(`merge-gate: posting the status failed: ${status.err}`);

const merge = run("gh", [
  "pr",
  "merge",
  pr,
  "--merge",
  "--match-head-commit",
  headSha,
]);
process.stdout.write(`${merge.out}${merge.err}\n`);
process.exit(merge.status === 0 ? 0 : 1);
