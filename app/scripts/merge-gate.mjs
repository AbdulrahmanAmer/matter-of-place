import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = "AbdulrahmanAmer/matter-of-place";
// The repository owner's account: workspace/05-plans/merge-gate.mjs posts its statuses with the operator's own
// `gh` login, while a workflow token posts as github-actions[bot], so only the owner's status is trusted.
const OWNER = "AbdulrahmanAmer";
const WORKFLOWS = fileURLToPath(new URL("../../.github/workflows/", import.meta.url));
const HEAVY = ["db", "e2e", "preview"];
export const PREVIEW_LOCAL_TRACE =
  "merge-gate: preview accepted from the preview-local status (ruling H73)";

// Every job a pull request can reach, by job key. A check is required only when the workflow
// at the merge commit defines it (B1b invariant 6b); hygiene.test.ts keeps this list whole.
export const REQUIRED_PR_CHECKS = ["check", "build", "db", "e2e", "preview"];

/**
 * @typedef {{ number: number, author: string, head: string }} PullRequest
 * @typedef {{ context: string, state: string, description?: string, creator?: string }} CommitStatus
 * @typedef {{ id: number, name: string, status: string, conclusion: string | null }} CheckRun
 * @typedef {{
 *   sha: string,
 *   pr: PullRequest | null,
 *   statuses: CommitStatus[],
 *   checkRuns: CheckRun[],
 *   definedJobs: string[],
 *   ciHeavy: string | undefined,
 * }} GateInput
 */

/**
 * The job keys of a workflow file. Plain text on purpose: the `merge-gate` job installs nothing,
 * so there is no YAML parser; hygiene.test.ts compares this with the parsed keys.
 * @param {string} text
 * @returns {string[]}
 */
export function jobKeys(text) {
  /** @type {string[]} */
  const keys = [];
  let inJobs = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^jobs:\s*(#.*)?$/.test(line)) {
      inJobs = true;
    } else if (inJobs && /^[^\s#]/.test(line)) {
      break;
    } else if (inJobs) {
      const key = /^ {2}([\w-]+):/.exec(line)?.[1];
      if (key !== undefined) keys.push(key);
    }
  }
  return keys;
}

/**
 * The check runs of one SHA hold one run per workflow run: the draft run, a cancelled one and a
 * re-run all stay beside the one that counts. The latest (highest id) of a name is the verdict,
 * except a skipped run, which only counts when every run of the name was skipped: closing the pull
 * request starts `deploy.yml` once more and that run reports every job as skipped on the same head
 * (GOTCHAS P-505), after the run that did the work.
 * @param {CheckRun[]} checkRuns
 * @param {string} name
 * @returns {CheckRun | undefined}
 */
function latestRun(checkRuns, name) {
  const named = checkRuns.filter((run) => run.name === name);
  const ran = named.filter((run) => run.conclusion !== "skipped");
  return (ran.length ? ran : named).reduce(
    (/** @type {CheckRun | undefined} */ latest, run) =>
      latest === undefined || run.id > latest.id ? run : latest,
    undefined,
  );
}

/**
 * Ruling H73: while Cloudflare's daily limit makes the edge answer 429, workspace/05-plans/merge-gate.mjs
 * accepts a local preview log for a red `preview` check and posts a `preview-local` status on the head
 * (`H73: preview behaviour run on the laptop, pr-<n>-<head7>.md`). That status stands in for the check here
 * only when it is `success`, was created by the owner's account and names H73 and this pull request's log.
 * The ruling covers a preview that failed at its `wait` step or later; the step cannot be read here: the
 * job API needs `actions: read`, which this job's token does not have (hygiene.test.ts pins its
 * permissions), so the check's conclusion must be `failure` and nothing else (not cancelled, not pending).
 * @param {CommitStatus} local the latest `preview-local` status of the head
 * @param {PullRequest} pr
 * @param {string} conclusion the `preview` check's conclusion
 * @returns {string} why the status does not stand in, or "" when it does
 */
function previewLocalRefusal(local, pr, conclusion) {
  const log = `pr-${String(pr.number)}-${pr.head.slice(0, 7)}.md`;
  if (local.state !== "success") return `preview-local ${local.state}`;
  if (local.creator !== OWNER) {
    return `preview-local created by ${local.creator ?? "nobody"}, not ${OWNER}`;
  }
  if (!/^H73: /.test(local.description ?? "") || !(local.description ?? "").endsWith(`, ${log}`)) {
    return `preview-local does not name H73 and ${log}`;
  }
  if (conclusion !== "failure") return `preview-local covers a failed preview, not ${conclusion}`;
  return "";
}

/**
 * The rule of invariant 6b, after the merge: the pull request head carries the `merge-gate`
 * status posted by workspace/05-plans/merge-gate.mjs and every required check concluded
 * `success` on it, or, for `preview` only, an accepted `preview-local` status (ruling H73).
 * `lines` holds each refusal first, then the printed exceptions.
 * @param {GateInput} input
 * @returns {{ ok: boolean, lines: string[] }}
 */
export function evaluateMergeGate({ sha, pr, statuses, checkRuns, definedJobs, ciHeavy }) {
  /** @param {string} what */
  const refuse = (what) => `unverified merge ${sha}: ${what}`;
  if (pr === null) return { ok: false, lines: [refuse("no pull request")] };
  /** @type {string[]} */
  const failures = [];
  /** @type {string[]} */
  const notes = [];
  const gate = statuses.find((status) => status.context === "merge-gate");
  if (gate?.state !== "success") failures.push(refuse(`merge-gate ${gate?.state ?? "missing"}`));
  for (const job of REQUIRED_PR_CHECKS.filter((name) => definedJobs.includes(name))) {
    if (job === "preview" && pr.author === "dependabot[bot]") {
      notes.push("preview not required: author is dependabot[bot]");
      continue;
    }
    const run = latestRun(checkRuns, job);
    if (run === undefined) {
      failures.push(refuse(`${job} missing`));
      continue;
    }
    const conclusion = run.conclusion ?? run.status;
    if (conclusion === "success") continue;
    const local =
      job === "preview" ? statuses.find((status) => status.context === "preview-local") : undefined;
    if (conclusion === "skipped" && ciHeavy === "off" && HEAVY.includes(job)) {
      notes.push(`heavy check skipped (CI_HEAVY=off): ${job}`);
    } else if (local !== undefined) {
      const refusal = previewLocalRefusal(local, pr, conclusion);
      if (refusal === "") notes.push(PREVIEW_LOCAL_TRACE);
      else failures.push(refuse(`${job} ${conclusion}; ${refusal}`));
    } else {
      failures.push(refuse(`${job} ${conclusion}`));
    }
  }
  const verified =
    failures.length === 0 ? [`merge-gate: OK ${sha} (pull request #${String(pr.number)})`] : [];
  return { ok: failures.length === 0, lines: [...failures, ...notes, ...verified] };
}

/**
 * @param {string} text
 * @returns {string[][]}
 */
function tsv(text) {
  return text
    .split(/\r?\n/)
    .filter((line) => line !== "")
    .map((line) => line.split("\t"));
}

/**
 * Reads the merged pull request and its head's statuses and check runs through `gh`.
 * @param {{
 *   sha: string,
 *   gh: (args: string[]) => string,
 *   workflows: string[],
 *   ciHeavy: string | undefined,
 * }} input `workflows`: the text of ci.yml and deploy.yml at `sha`.
 * @returns {GateInput}
 */
export function gatherInput({ sha, gh, workflows, ciHeavy }) {
  const definedJobs = workflows.flatMap(jobKeys);
  const pulls = tsv(
    gh([
      "api",
      `repos/${REPO}/commits/${sha}/pulls`,
      "--jq",
      ".[] | [.merge_commit_sha, .number, .head.sha, .user.login] | @tsv",
    ]),
  );
  const merged = pulls.find(([mergeSha]) => mergeSha === sha);
  if (merged === undefined) {
    return { sha, pr: null, statuses: [], checkRuns: [], definedJobs, ciHeavy };
  }
  const [, number = "", headSha = "", author = ""] = merged;
  // The list of statuses, not the combined status: only the list carries `creator`, which the
  // preview-local rule needs (ruling H73). It is newest first, so the first of a context is its
  // current state, as the combined status reports it.
  const statuses = tsv(
    gh([
      "api",
      "--paginate",
      `repos/${REPO}/commits/${headSha}/statuses?per_page=100`,
      "--jq",
      '.[] | [.context, .state, (.description // ""), (.creator.login // "")] | @tsv',
    ]),
  ).map(([context = "", state = "", description = "", creator = ""]) => ({
    context,
    state,
    description,
    creator,
  }));
  const checkRuns = tsv(
    gh([
      "api",
      "--paginate",
      `repos/${REPO}/commits/${headSha}/check-runs?per_page=100`,
      "--jq",
      '.check_runs[] | [.id, .name, .status, (.conclusion // "")] | @tsv',
    ]),
  ).map(([id = "", name = "", status = "", conclusion = ""]) => ({
    id: Number(id),
    name,
    status,
    conclusion: conclusion === "" ? null : conclusion,
  }));
  return {
    sha,
    pr: { number: Number(number), author, head: headSha },
    statuses,
    checkRuns,
    definedJobs,
    ciHeavy,
  };
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const sha = process.env["GITHUB_SHA"] ?? "";
  if (sha === "") {
    process.stdout.write("merge-gate: GITHUB_SHA is not set\n");
    process.exit(2);
  }
  const workflows = ["ci.yml", "deploy.yml"]
    .map((file) => `${WORKFLOWS}${file}`)
    .filter((path) => existsSync(path))
    .map((path) => readFileSync(path, "utf8"));
  const input = gatherInput({
    sha,
    gh: (args) => execFileSync("gh", args, { encoding: "utf8" }),
    workflows,
    ciHeavy: process.env["CI_HEAVY"],
  });
  const { ok, lines } = evaluateMergeGate(input);
  for (const line of lines) {
    process.stdout.write(`${line}\n`);
  }
  if (!ok) {
    process.exit(1);
  }
}
