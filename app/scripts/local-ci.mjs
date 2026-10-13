// `node scripts/local-ci.mjs --pr <n>`, run from `app/` of the pull request's worktree (ruling H103).
// While GitHub Actions starts no job on the private repo ("The job was not started because recent account payments
// have failed or your spending limit needs to be increased", GOTCHAS P-3456), this runs the `check` and `build` jobs
// of ci.yml and the unit mutation replay on the laptop, one step after the other, on the pull request's head with a
// clean tree, and writes workspace/05-plans/logs/local-ci/pr-<n>-<head7>.md. `node workspace/05-plans/merge-gate.mjs
// <n> --local-ci <log>` accepts that log in place of the checks GitHub did not start. The `db` and `e2e` jobs start
// Docker, which never runs on this laptop (S50): the log says so, and so must the pull request.
// Exit 0 only when every step passed; the log path is the last line printed.
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";
import { z } from "zod";

const USAGE = "usage: node scripts/local-ci.mjs --pr <n>";
const REPO = "AbdulrahmanAmer/matter-of-place";
// The build job's values (ci.yml): live mode, and Cloudflare's public always-pass Turnstile test key.
const BUILD_ENV = {
  VITE_API_BASE_URL: "/api/public",
  VITE_TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
};
const TAIL = 25;

/** The steps of the log, in the order ci.yml runs them, then the replay of its db job's unit half. */
export const CI_STEPS = /** @type {const} */ ([
  "engines",
  "install",
  "migration-order",
  "check",
  "audit",
  "audit launch",
  "deno",
  "runbook-lint",
  "build",
  "worker-name",
  "bundle-check",
  "mutation replay",
  "tree after",
]);
export const NOT_RUN = "not run: db, e2e (they start Docker, which never runs on this laptop, S50)";

/**
 * @typedef {typeof CI_STEPS[number]} StepName
 * @typedef {{ name: string, verdict: string, detail: string }} Step
 */

/**
 * The header and the steps of a log.
 * @param {string} text
 * @returns {{ pr: string, head: string, tree: string, steps: Step[], notRun: boolean }}
 */
export function parseCiLog(text) {
  /** @type {Record<string, string>} */
  const header = {};
  /** @type {Step[]} */
  const steps = [];
  for (const line of text.split(/\r?\n/)) {
    const field = /^(pr|head|tree): (.*)$/.exec(line);
    if (field) header[field[1] ?? ""] = (field[2] ?? "").trim();
    const step = /^- step (.+?): (pass|fail)(?: \((.*)\))?$/.exec(line);
    if (step) steps.push({ name: step[1] ?? "", verdict: step[2] ?? "", detail: step[3] ?? "" });
  }
  return {
    pr: header["pr"] ?? "",
    head: header["head"] ?? "",
    tree: header["tree"] ?? "",
    steps,
    notRun: text.includes(NOT_RUN),
  };
}

/**
 * Ruling H103's reading of a log: it is for this pull request and this head, run on a clean tree, every step of
 * CI_STEPS ran in order and passed, and it names the jobs it could not run.
 * @param {string} text
 * @param {string} pr
 * @param {string} headSha
 * @returns {string} the reason the log is refused, or "" when it is accepted
 */
export function localCiProblem(text, pr, headSha) {
  const log = parseCiLog(text);
  if (log.pr !== pr) return `the log is for pull request ${log.pr || "(none)"}, not ${pr}`;
  if (log.head !== headSha) {
    return `the log's head ${log.head || "(none)"} is not the pull request's head ${headSha}`;
  }
  if (log.tree !== "clean")
    return `the log's tree was ${log.tree || "(none)"}, so the run was not the head`;
  const names = log.steps.map((step) => step.name);
  if (names.join(",") !== CI_STEPS.join(",")) {
    return `the log's steps are ${names.join(", ") || "(none)"}, not ${CI_STEPS.join(", ")}`;
  }
  const failed = log.steps.find((step) => step.verdict !== "pass");
  if (failed) return `${failed.name} is ${failed.verdict} in the log: ${failed.detail}`;
  if (!log.notRun) return "the log does not name the jobs it could not run";
  return "";
}

/**
 * The replay's own summary line, and only a finished, clean one (GOTCHAS P-3455).
 * @param {string} output
 * @returns {boolean}
 */
export function replayClean(output) {
  return /^watchfail: replayed \d+: ok \d+, bad 0, stale 0/m.test(output);
}

/**
 * True when a failed `bun run check` failed only because vitest workers did not start (GOTCHAS P-712): every stage
 * before the tests passed, at least one "Failed to start forks worker", and no failed test or file.
 * @param {string} output
 * @returns {boolean}
 */
export function workersOnly(output) {
  return (
    /Failed to start forks worker/.test(output) &&
    !/^\s*(×|FAIL)\s/m.test(output) &&
    !/Test Files\s+\d+ failed/.test(output) &&
    /error: script "test" exited/.test(output)
  );
}

// ---------------------------------------------------------------------------------------------------------------
// The run itself. Everything below talks to processes and the disk.

const APP = fileURLToPath(new URL("..", import.meta.url));
const ROOT = resolve(APP, "..");
const LOG_DIR = "workspace/05-plans/logs/local-ci";

/** Never a Cloudflare credential and never the shell's Supabase pair, which on this laptop belongs to another business. */
/** @param {Record<string, string>} [extra] */
function childEnv(extra = {}) {
  const withheld = [
    "CLOUDFLARE_API_TOKEN",
    "CLOUDFLARE_ACCOUNT_ID",
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
  ];
  return Object.fromEntries(
    Object.entries({ ...process.env, ...extra }).filter(([name]) => !withheld.includes(name)),
  );
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {{ cwd?: string, env?: Record<string, string> }} [options]
 */
function sh(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? APP,
    env: childEnv(options.env),
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024,
  });
  const out = stripVTControlCharacters(`${result.stdout}${result.stderr}`);
  return { ok: result.status === 0 && result.error === undefined, status: result.status, out };
}

const tail = (/** @type {string} */ out) => out.trimEnd().split("\n").slice(-TAIL);

/** @param {string[]} argv */
function main(argv) {
  const at = argv.indexOf("--pr");
  const pr = at >= 0 ? argv[at + 1] : undefined;
  if (pr === undefined || !/^\d+$/.test(pr) || argv.length !== 2) {
    console.error(USAGE);
    return 2;
  }
  const head = sh("git", ["rev-parse", "HEAD"]).out.trim();
  const prHead = sh("gh", [
    "pr",
    "view",
    pr,
    "-R",
    REPO,
    "--json",
    "headRefOid",
    "--jq",
    ".headRefOid",
  ]).out.trim();
  if (head !== prHead) {
    console.error(`local-ci: this worktree is at ${head}, pull request ${pr} is at ${prHead}`);
    return 1;
  }
  const tree = sh("git", ["status", "--porcelain"]).out.trim() === "" ? "clean" : "dirty";
  sh("git", ["fetch", "--quiet", "origin", "main"]);

  const { engines } = z
    .object({ engines: z.object({ bun: z.string(), node: z.string() }) })
    .parse(JSON.parse(readFileSync(join(APP, "package.json"), "utf8")));
  /** @type {Record<StepName, () => { ok: boolean, detail: string, out: string }>} */
  const run = {
    engines: () => {
      const bun = sh("bun", ["--version"]).out.trim();
      const node = process.version.slice(1).split(".")[0] ?? "";
      const ok = engines.bun === bun && engines.node === `${node}.x`;
      return { ok, detail: `bun ${bun}, node ${node}`, out: "" };
    },
    install: () => step(sh("bun", ["install", "--frozen-lockfile"])),
    "migration-order": () => step(sh("bun", ["run", "migrations:check"])),
    check: () => {
      const first = sh("bun", ["run", "check"]);
      if (first.ok || !workersOnly(first.out)) return step(first);
      // GOTCHAS P-712: workers that never started under load, and no failed test, is not a red; the test stage runs
      // once more alone, and the log says so.
      const again = sh("bun", ["run", "test"]);
      return {
        ok: again.ok,
        detail: `check exit ${String(first.status)} on workers that did not start only; test alone exit ${String(again.status)}`,
        out: again.out,
      };
    },
    audit: () => step(sh("bun", ["run", "audit:deps"])),
    "audit launch": () => {
      const cwd = join(ROOT, "launch");
      const install = sh("bun", ["install", "--frozen-lockfile"], { cwd });
      return install.ok ? step(sh("bun", ["run", "audit:deps"], { cwd })) : step(install);
    },
    deno: () => {
      const config = "supabase/functions/job-runner/deno.json";
      const portable = sh("deno", ["check", "--config", config, "scripts/deno-portable.ts"]);
      if (!portable.ok) return step(portable);
      return step(
        sh("deno", [
          "check",
          "--frozen",
          "--config",
          config,
          "supabase/functions/job-runner/index.ts",
        ]),
      );
    },
    "runbook-lint": () => step(sh("node", ["scripts/harden/runbook-lint.mjs", "docs/runbooks"])),
    build: () => step(sh("bun", ["run", "build"], { env: BUILD_ENV })),
    "worker-name": () => {
      const { name } = z
        .object({ name: z.string() })
        .parse(JSON.parse(readFileSync(join(APP, ".output/server/wrangler.json"), "utf8")));
      return { ok: name === "matter-of-place", detail: `worker ${name}`, out: "" };
    },
    "bundle-check": () => step(sh("node", ["scripts/bundle-check.mjs"])),
    "mutation replay": () => {
      const replay = sh("node", [
        "scripts/watchfail.mjs",
        "--registry",
        "tests/mutations",
        "--changed",
        "origin/main",
        "--kinds",
        "unit",
      ]);
      const summary = /^watchfail: replayed .*$/m.exec(replay.out)?.[0] ?? "no summary line";
      return { ok: replay.ok && replayClean(replay.out), detail: summary, out: replay.out };
    },
    "tree after": () => {
      const left = sh("git", ["status", "--porcelain"]).out.trim();
      return {
        ok: left === "",
        detail: left === "" ? "clean" : left.split("\n").join("; "),
        out: "",
      };
    },
  };

  const lines = [
    `# Local CI for pull request ${pr} (ruling H103)`,
    "",
    `pr: ${pr}`,
    `head: ${head}`,
    `tree: ${tree}`,
    "",
  ];
  let failed = tree !== "clean";
  for (const name of CI_STEPS) {
    if (failed) break;
    const started = Date.now();
    const result = run[name]();
    const seconds = Math.round((Date.now() - started) / 1000);
    lines.push(
      `- step ${name}: ${result.ok ? "pass" : "fail"} (${result.detail}${result.detail ? ", " : ""}${String(seconds)} s)`,
    );
    console.log(lines.at(-1));
    if (!result.ok) {
      failed = true;
      lines.push("", "```", ...tail(result.out), "```");
    }
  }
  lines.push("", NOT_RUN, "");
  mkdirSync(join(ROOT, LOG_DIR), { recursive: true });
  const path = join(ROOT, LOG_DIR, `pr-${pr}-${head.slice(0, 7)}.md`);
  writeFileSync(path, lines.join("\n"));
  console.log(path);
  return failed ? 1 : 0;
}

/** @param {{ ok: boolean, status: number | null, out: string }} result */
function step(result) {
  return {
    ok: result.ok,
    detail: result.ok ? "" : `exit ${String(result.status)}`,
    out: result.out,
  };
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
