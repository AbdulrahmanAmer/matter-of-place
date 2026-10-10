// `node scripts/preview-local.mjs --pr <n> [--port 8970] [--mode live|local]`, run from `app/` (ruling H73).
// While the edge answers Cloudflare's 429 (GOTCHAS P-543, the Workers Free daily request limit), every Worker on
// holy-meadow-4327.workers.dev is unreachable and the `preview` job of deploy.yml fails at its `wait` step although the
// deploy passed. This script runs the behavioural half of that job on the laptop, on the same build in the local Worker
// runtime (`wrangler dev`), and writes workspace/05-plans/logs/preview-local/pr-<n>-<head7>.md, which
// `node workspace/05-plans/merge-gate.mjs <n> --local-preview <log>` accepts in place of the preview check.
// Nothing is skipped silently: the log says which steps ran, which were not possible locally and why. Exit 0 only when
// every hard step passed; the log path is the last line printed.
import { spawn, spawnSync } from "node:child_process";
import {
  closeSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";

const USAGE = "usage: node scripts/preview-local.mjs --pr <n> [--port 8970] [--mode live|local]";
const REPO = "AbdulrahmanAmer/matter-of-place";
// Lane ports 8900-8999 belong to the workflows' local runs (P-503); this one is free of them.
const DEFAULT_PORT = 8970;
// Cloudflare's public always-pass Turnstile test key, as on every preview.
const TURNSTILE_TEST_KEY = "1x00000000000000000000AA";
// The change test of deploy.yml, character for character.
const FRONT_END = /^app\/(src\/|public\/|package\.json$|budget\.json$)/;
const TAIL = 20;
const MINUTE = 60_000;

/** The steps of the log, in the order deploy.yml runs them. */
export const STEPS = /** @type {const} */ ([
  "build",
  "no-cron",
  "wait",
  "smoke",
  "essentials",
  "observatory",
  "change test",
  "overflow",
  "lighthouse",
]);

/**
 * @typedef {typeof STEPS[number]} StepName
 * @typedef {"pass" | "fail" | "skipped" | "not run"} Verdict
 * @typedef {"live" | "local"} Mode
 * @typedef {{ heading: string, lines: string[] }} Earlier an earlier attempt of a step, kept under its own heading
 * @typedef {{ name: StepName, verdict: Verdict, detail: string, tail: string[], earlier?: Earlier[] }} Step
 * @typedef {{
 *   pr: string,
 *   head: string,
 *   tree: string,
 *   date: string,
 *   port: number,
 *   mode: Mode,
 *   steps: Step[],
 * }} Run
 * @typedef {{ pr: string, port: number, mode: Mode }} Args
 */

/**
 * @param {string[]} argv the arguments after the script name
 * @returns {Args | string} the arguments, or what is wrong with them
 */
export function parseArgs(argv) {
  /** @type {Record<string, string>} */
  const given = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i] ?? "";
    const value = argv[i + 1];
    if (!["--pr", "--port", "--mode"].includes(flag) || value === undefined) return USAGE;
    given[flag] = value;
  }
  const pr = given["--pr"] ?? "";
  const port = Number(given["--port"] ?? DEFAULT_PORT);
  const mode = given["--mode"] ?? "live";
  if (!/^\d+$/.test(pr)) return USAGE;
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    return `${USAGE}\nport ${String(port)}`;
  if (mode !== "live" && mode !== "local") return `${USAGE}\nmode ${mode}`;
  return { pr, port, mode };
}

/**
 * The change test of deploy.yml: true when a changed path is front-end.
 * @param {string[]} files
 * @returns {boolean}
 */
export function frontEndChanged(files) {
  return files.some((file) => FRONT_END.test(file));
}

/**
 * `--collect.url=<url>` for each line `scripts/lhci-urls.mjs` printed.
 * @param {string} printed
 * @returns {string[]}
 */
export function lhciUrlArgs(printed) {
  return printed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((url) => `--collect.url=${url}`);
}

/** Ruling H71: the Lighthouse step runs the same command at most this many times, as deploy.yml's does. */
export const LIGHTHOUSE_ATTEMPTS = 2;
const RETRIED = "did not finish, retried under ruling H71";

/**
 * @typedef {{ code: number | null, timedOut: boolean, lines: string[], seconds: number, label: string }} Attempt
 */

/**
 * Whether the Lighthouse step runs again: the last attempt failed and fewer than two have run (H71).
 * @param {Attempt[]} attempts the attempts made so far, in order
 * @returns {boolean}
 */
export function lighthouseRetry(attempts) {
  const last = attempts.at(-1);
  return last !== undefined && last.code !== 0 && attempts.length < LIGHTHOUSE_ATTEMPTS;
}

/**
 * The Lighthouse step from its attempts: the last attempt decides, the detail says `attempt 2 of 2` when the second ran,
 * and a first attempt that failed stays in the record under its own heading (5 lines when the retry passed, 20 when it
 * failed too).
 * @param {Attempt[]} attempts one or two attempts, in order
 * @returns {Step}
 */
export function lighthouseStep(attempts) {
  const last = attempts.at(-1);
  const first = attempts[0];
  if (last === undefined || first === undefined) {
    return step("lighthouse", "fail", "no attempt was made");
  }
  const note =
    attempts.length > 1
      ? `attempt ${String(attempts.length)} of ${String(LIGHTHOUSE_ATTEMPTS)}`
      : "";
  const label = [last.label, note].filter((part) => part !== "").join(", ");
  const done = judged(last, "lighthouse", label);
  if (attempts.length === 1 || first.code === 0) return done;
  const kept = done.verdict === "pass" ? 5 : TAIL;
  return {
    ...done,
    earlier: [{ heading: `lighthouse attempt 1 (${RETRIED})`, lines: first.lines.slice(-kept) }],
  };
}

/**
 * A time with its numeric offset, as `date "+%Y-%m-%d %H:%M %z"` prints it (P-130).
 * @param {Date} date
 * @returns {string}
 */
export function stamp(date) {
  const pad = (/** @type {number} */ n) => String(n).padStart(2, "0");
  const offset = -date.getTimezoneOffset();
  const sign = offset < 0 ? "-" : "+";
  const abs = Math.abs(offset);
  return (
    `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())} ${sign}${pad(Math.floor(abs / 60))}${pad(abs % 60)}`
  );
}

const FENCE = "```";

/**
 * The log file of one run.
 * @param {Run} run
 * @returns {string}
 */
export function renderLog(run) {
  const how =
    run.mode === "live"
      ? "live (VITE_API_BASE_URL from the repository variable, MOP_ENV preview, essentials E2E_MODE live)"
      : "local (VITE_API_BASE_URL empty, MOP_ENV local, essentials E2E_MODE local)";
  const tails = run.steps
    .filter((step) => step.verdict === "fail" && step.tail.length > 0)
    .flatMap((step) => [
      "",
      `## Output of ${step.name} (last ${String(step.tail.length)} lines)`,
      "",
      `${FENCE}text`,
      ...step.tail,
      FENCE,
    ]);
  const earlier = run.steps.flatMap((step) =>
    (step.earlier ?? []).flatMap((kept) => [
      "",
      `## ${kept.heading}`,
      "",
      `${FENCE}text`,
      ...kept.lines,
      FENCE,
    ]),
  );
  return [
    `# Local preview of pull request ${run.pr} (ruling H73)`,
    "",
    "The edge answered Cloudflare's 429 (GOTCHAS P-543), so the behavioural half of deploy.yml's preview job ran on the",
    "laptop against the same build in the local Worker runtime (`wrangler dev`). Written by `scripts/preview-local.mjs`;",
    "`node workspace/05-plans/merge-gate.mjs <pr> --local-preview <this file>` reads it.",
    "",
    `- pr: ${run.pr}`,
    `- head: ${run.head}`,
    `- tree: ${run.tree}`,
    `- date: ${run.date}`,
    `- port: ${String(run.port)}`,
    `- mode: ${how}`,
    "",
    "## Steps",
    "",
    `${FENCE}text`,
    ...run.steps.map((step) => `${step.name} | ${step.verdict} | ${step.detail}`),
    FENCE,
    ...tails,
    ...earlier,
    "",
  ].join("\n");
}

const HEADER = /^- (pr|head|tree|mode): (.*)$/gm;
const STEP_LINE = /^([a-z][a-z -]*[a-z]) \| (pass|fail|skipped|not run) \| (.*)$/gm;

/**
 * Reads a log back: its header lines and the step lines of its Steps section.
 * @param {string} text
 * @returns {{ pr: string, head: string, tree: string, mode: string, steps: { name: string, verdict: string, detail: string }[] }}
 */
export function parseLog(text) {
  /** @type {Record<string, string>} */
  const header = {};
  const top = text.split("\n## ")[0] ?? "";
  for (const [, key = "", value = ""] of top.matchAll(HEADER)) header[key] = value.trim();
  const section = /\n## Steps\n([\s\S]*?)(?:\n## |$)/.exec(text)?.[1] ?? "";
  const steps = [...section.matchAll(STEP_LINE)].map(
    ([, name = "", verdict = "", detail = ""]) => ({
      name,
      verdict,
      detail,
    }),
  );
  return {
    pr: header["pr"] ?? "",
    head: header["head"] ?? "",
    tree: header["tree"] ?? "",
    mode: (header["mode"] ?? "").split(" ")[0] ?? "",
    steps,
  };
}

/**
 * Ruling H73's reading of a log: it is for this pull request and this head, built from a clean tree, and every hard
 * step passed. Overflow and Lighthouse may be skipped only when the change test found no front-end change, as in CI;
 * the observatory may be "not run", because Mozilla Observatory scans public hosts only.
 * @param {string} text
 * @param {string} pr
 * @param {string} headSha
 * @returns {string} the reason the log is refused, or "" when it is accepted
 */
export function localPreviewProblem(text, pr, headSha) {
  const log = parseLog(text);
  if (log.pr !== pr) return `the log is for pull request ${log.pr || "(none)"}, not ${pr}`;
  if (log.head !== headSha) {
    return `the log's head ${log.head || "(none)"} is not the pull request's head ${headSha}`;
  }
  if (log.tree !== "clean")
    return `the log's tree was ${log.tree || "(none)"}, so the build was not the head`;
  const names = log.steps.map((step) => step.name);
  if (names.join(",") !== STEPS.join(",")) {
    return `the log's steps are ${names.join(", ") || "(none)"}, not ${STEPS.join(", ")}`;
  }
  const change = log.steps.find((step) => step.name === "change test");
  const changed = /changed=(true|false)/.exec(change?.detail ?? "")?.[1];
  for (const step of log.steps) {
    if (step.verdict === "pass") continue;
    if (step.name === "observatory" && step.verdict === "not run") continue;
    const optional = step.name === "overflow" || step.name === "lighthouse";
    if (optional && step.verdict === "skipped" && changed === "false") continue;
    return `${step.name} is ${step.verdict} in the log: ${step.detail}`;
  }
  return "";
}

// ---------------------------------------------------------------------------------------------------------------
// The run itself. Everything below talks to processes, the network and the disk.

const APP = fileURLToPath(new URL("..", import.meta.url));
const ROOT = resolve(APP, "..");
const LOG_DIR = "workspace/05-plans/logs/preview-local";

/**
 * The environment every child gets: never a Cloudflare credential (local mode needs none, P-310) and never the shell's
 * Supabase pair, which on this laptop belongs to another business (GOTCHAS, READ FIRST).
 * @param {Record<string, string>} extra
 * @returns {NodeJS.ProcessEnv}
 */
function childEnv(extra) {
  const withheld = [
    "CLOUDFLARE_API_TOKEN",
    "CLOUDFLARE_ACCOUNT_ID",
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
  ];
  return Object.fromEntries(
    Object.entries({ ...process.env, WRANGLER_SEND_METRICS: "false", ...extra }).filter(
      ([name]) => !withheld.includes(name.toUpperCase()),
    ),
  );
}

/**
 * Stops a process and its children: wrangler's node parent respawns workerd, so the whole tree goes (P-042).
 * @param {number | undefined} pid
 */
function killTree(pid) {
  if (pid === undefined) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    return;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    // Already gone.
  }
}

/**
 * Runs a command to its end, its output written whole to `out` and its last lines kept.
 * @param {string} command
 * @param {string[]} args
 * @param {{ env: NodeJS.ProcessEnv, out: string, timeoutMs: number }} options
 * @returns {Promise<{ code: number | null, timedOut: boolean, lines: string[], stdout: string, seconds: number }>}
 */
function execute(command, args, { env, out, timeoutMs }) {
  return new Promise((done) => {
    const started = Date.now();
    const sink = createWriteStream(out);
    /** @type {string[]} */
    const lines = [];
    let stdout = "";
    let rest = "";
    let timedOut = false;
    let settled = false;
    /** @param {string} line */
    const keep = (line) => {
      lines.push(clean(line));
      if (lines.length > 200) lines.shift();
    };
    /** @param {Buffer} chunk */
    const take = (chunk) => {
      sink.write(chunk);
      const parts = (rest + chunk.toString("utf8")).split(/\r?\n/);
      rest = parts.pop() ?? "";
      parts.forEach(keep);
    };
    const child = spawn(command, args, {
      cwd: APP,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      detached: process.platform !== "win32",
    });
    child.stdout.on("data", (/** @type {Buffer} */ chunk) => {
      stdout += chunk.toString("utf8");
      take(chunk);
    });
    child.stderr.on("data", take);
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child.pid);
    }, timeoutMs);
    /** @param {number | null} code */
    const finish = (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (rest !== "") keep(rest);
      sink.end();
      done({ code, timedOut, lines, stdout, seconds: Math.round((Date.now() - started) / 1000) });
    };
    child.on("error", (error) => {
      keep(`${command}: ${error.message}`);
      finish(null);
    });
    child.on("close", finish);
  });
}

/**
 * An output line as the log keeps it: no colour codes and no carriage return (Windows' taskkill writes `\r\r\n`, which
 * left a CR in the first log, R56).
 * @param {string} line
 * @returns {string}
 */
const clean = (line) => stripVTControlCharacters(line).replaceAll("\r", "");

/** @param {number} ms */
const pause = (ms) => new Promise((done) => setTimeout(done, ms));

/**
 * @param {string} url
 * @returns {Promise<Response | null>}
 */
async function get(url) {
  try {
    const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(5_000) });
    await response.arrayBuffer();
    return response;
  } catch {
    return null;
  }
}

/**
 * @param {string} command
 * @param {string[]} args
 * @returns {{ code: number | null, out: string }}
 */
function quick(command, args) {
  const result = spawnSync(command, args, { cwd: APP, encoding: "utf8", windowsHide: true });
  return { code: result.status, out: (result.stdout || "").trim() };
}

/**
 * @param {StepName} name
 * @param {Verdict} verdict
 * @param {string} detail
 * @param {string[]} [tail]
 * @returns {Step}
 */
const step = (name, verdict, detail, tail = []) => ({
  name,
  verdict,
  detail,
  tail: tail.slice(-TAIL),
});

/**
 * @param {{ code: number | null, timedOut: boolean, lines: string[], seconds: number }} result
 * @param {StepName} name
 * @param {string} [label]
 * @returns {Step}
 */
function judged(result, name, label = "") {
  const prefix = label === "" ? "" : `${label}, `;
  if (result.code === 0) return step(name, "pass", `${prefix}${String(result.seconds)} s`);
  const why = result.timedOut ? "stopped at its time limit" : `exit ${String(result.code)}`;
  return step(name, "fail", `${prefix}${why} after ${String(result.seconds)} s`, result.lines);
}

/** @param {Args} args */
async function main({ pr, port, mode }) {
  const base = `http://127.0.0.1:${String(port)}`;
  const head = quick("git", ["rev-parse", "HEAD"]).out;
  const dirty = quick("git", ["status", "--porcelain", "--untracked-files=no"]).out;
  const tree = dirty === "" ? "clean" : `dirty (${String(dirty.split("\n").length)} changed files)`;
  if (!/^[0-9a-f]{40}$/.test(head)) {
    process.stdout.write("preview-local: cannot read the head of this tree\n");
    return 2;
  }
  // A server already on the port would be measured instead of this build, and holds .output (P-042, P-839).
  if ((await get(`${base}/`)) !== null) {
    process.stdout.write(
      `preview-local: ${base} already answers; stop that server first (GOTCHAS P-042)\n`,
    );
    return 2;
  }
  const raw = join(tmpdir(), "mop-preview-local", `pr-${pr}-${head.slice(0, 7)}`);
  mkdirSync(raw, { recursive: true });
  const persist = mkdtempSync(join(tmpdir(), "mop-preview-local-state-"));
  process.stdout.write(`preview-local: pr ${pr}, head ${head}, ${tree}, ${base}, mode ${mode}\n`);
  process.stdout.write(`preview-local: whole outputs in ${raw}\n`);

  /** @type {Step[]} */
  const steps = [];
  /** @param {Step} done */
  const record = (done) => {
    steps.push(done);
    process.stdout.write(`${done.name} | ${done.verdict} | ${done.detail}\n`);
  };
  /** @type {import("node:child_process").ChildProcess | undefined} */
  let server;
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    killTree(server?.pid);
  };
  const onSignal = () => {
    stop();
    process.exit(130);
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  process.on("exit", stop);

  try {
    // build: the variables of deploy.yml's build step, with this host as the site.
    let apiBase = "";
    if (mode === "live") {
      const variable = quick("gh", ["variable", "get", "VITE_API_BASE_URL", "--repo", REPO]);
      apiBase = variable.code === 0 ? variable.out : "";
    }
    if (mode === "live" && apiBase === "") {
      record(
        step(
          "build",
          "fail",
          "the repository variable VITE_API_BASE_URL cannot be read (gh variable get)",
        ),
      );
    } else {
      const env = childEnv({
        VITE_SITE_URL: base,
        VITE_API_BASE_URL: apiBase,
        VITE_TURNSTILE_SITE_KEY: TURNSTILE_TEST_KEY,
      });
      const build = await execute("bun", ["run", "build"], {
        env,
        out: join(raw, "build.out"),
        timeoutMs: 15 * MINUTE,
      });
      record(judged(build, "build", `VITE_API_BASE_URL=${apiBase === "" ? "(empty)" : apiBase}`));
    }

    const built = steps.at(-1)?.verdict === "pass";
    if (built) {
      const noCron = await execute(
        process.execPath,
        [
          "scripts/preview-no-cron.mjs",
          ".output/server/wrangler.json",
          ".output/server/wrangler.preview.json",
        ],
        { env: childEnv({}), out: join(raw, "no-cron.out"), timeoutMs: MINUTE },
      );
      record(judged(noCron, "no-cron", "wrangler.preview.json has no cron trigger"));
    } else {
      record(step("no-cron", "not run", "the build failed"));
    }

    // wait: deploy.yml deploys with --var; locally the same vars reach `wrangler dev`. The secrets come from app/.dev.vars,
    // copied beside the built config because wrangler reads it from there (P-073, P-839), without the three names the
    // --var flags set, so the flags decide them as on the preview.
    const mopEnv = mode === "live" ? "preview" : "local";
    const devVars = join(APP, ".dev.vars");
    if (steps.at(-1)?.verdict !== "pass") {
      record(step("wait", "not run", "nothing was built"));
    } else if (!existsSync(devVars)) {
      record(step("wait", "fail", "app/.dev.vars is missing (scripts/dev-vars.mjs writes it)"));
    } else {
      const overridden = /^(MOP_ENV|SENTRY_RELEASE|MEDIA_PUBLIC_BASE)=/;
      const vars = readFileSync(devVars, "utf8")
        .split(/\r?\n/)
        .filter((line) => !overridden.test(line))
        .join("\n");
      writeFileSync(join(APP, ".output/server/.dev.vars"), vars);
      const log = join(raw, "wrangler.out");
      const fd = openSync(log, "w");
      server = spawn(
        "bunx",
        [
          "wrangler",
          "dev",
          "--config",
          ".output/server/wrangler.preview.json",
          "--ip",
          "127.0.0.1",
          "--port",
          String(port),
          "--persist-to",
          persist,
          "--var",
          `MOP_ENV:${mopEnv}`,
          "--var",
          `SENTRY_RELEASE:${head}`,
          "--var",
          `MEDIA_PUBLIC_BASE:${base}/media`,
        ],
        {
          cwd: APP,
          env: childEnv({}),
          stdio: ["ignore", fd, fd],
          windowsHide: true,
          detached: process.platform !== "win32",
        },
      );
      closeSync(fd);
      /** @type {number | null | undefined} */
      let exited;
      server.on("exit", (code) => {
        exited = code;
      });
      server.on("error", () => {
        exited = null;
      });
      // The rule of deploy.yml's wait step: ten answers in a row that carry x-request-id, 90 tries 2 s apart.
      let inARow = 0;
      let verdict = step("wait", "fail", "the Worker did not answer ten times in a row in 180 s");
      for (let attempt = 1; attempt <= 90; attempt += 1) {
        if (exited !== undefined) {
          verdict = step("wait", "fail", `wrangler dev exited (${String(exited)})`);
          break;
        }
        const answer = await get(`${base}/`);
        inARow = answer?.headers.has("x-request-id") === true ? inARow + 1 : 0;
        if (inARow >= 10) {
          verdict = step(
            "wait",
            "pass",
            `ten answers in a row after ${String(attempt)} requests, MOP_ENV ${mopEnv}`,
          );
          break;
        }
        await pause(2_000);
      }
      if (verdict.verdict === "fail") {
        verdict = {
          ...verdict,
          tail: readFileSync(log, "utf8").split("\n").map(clean).slice(-TAIL),
        };
      }
      record(verdict);
    }

    const serving = steps.at(-1)?.verdict === "pass";
    const notServing = "the Worker did not start";

    // smoke: as the preview job, no robots flag (127.0.0.1 is noindex by default, as a workers.dev host).
    if (serving) {
      const smoke = await execute(process.execPath, ["scripts/smoke.mjs", base], {
        env: childEnv({}),
        out: join(raw, "smoke.out"),
        timeoutMs: 5 * MINUTE,
      });
      record(judged(smoke, "smoke"));
    } else {
      record(step("smoke", "not run", notServing));
    }

    // essentials: advisory on the preview (H67, the runner stall of P-1936); hard here, where that stall does not exist.
    if (serving) {
      /** @type {string[]} */
      let installed = [];
      const { chromium } = await import("@playwright/test");
      if (!existsSync(chromium.executablePath())) {
        const install = await execute("bun", ["run", "test:e2e:install"], {
          env: childEnv({}),
          out: join(raw, "install.out"),
          timeoutMs: 10 * MINUTE,
        });
        installed = install.code === 0 ? ["chromium installed"] : [];
      }
      const essentials = await execute(
        "bun",
        ["run", "test:e2e", "--", "tests/e2e/essentials.spec.ts"],
        {
          env: childEnv({ E2E_TARGET: "url", E2E_BASE_URL: base, E2E_MODE: mode }),
          out: join(raw, "essentials.out"),
          timeoutMs: 15 * MINUTE,
        },
      );
      const summary = essentials.lines.filter((line) =>
        /^\s*\d+ (passed|failed|flaky|skipped)/.test(line),
      );
      record(
        judged(
          essentials,
          "essentials",
          [`E2E_MODE ${mode}`, ...installed, ...summary.map((line) => line.trim())].join(", "),
        ),
      );
    } else {
      record(step("essentials", "not run", notServing));
    }

    record(
      step(
        "observatory",
        "not run",
        "not run locally (public scan only): Mozilla Observatory scans public hosts",
      ),
    );

    // change test: the files of the pull request from the API, the grep of deploy.yml.
    const files = quick("gh", [
      "api",
      `repos/${REPO}/pulls/${pr}/files`,
      "--paginate",
      "--jq",
      ".[].filename",
    ]);
    /** @type {boolean | undefined} */
    let changed;
    if (files.code !== 0) {
      record(step("change test", "fail", `gh api pulls/${pr}/files exit ${String(files.code)}`));
    } else {
      const list = files.out.split("\n").filter(Boolean);
      changed = frontEndChanged(list);
      record(
        step("change test", "pass", `changed=${String(changed)} (${String(list.length)} files)`),
      );
    }

    if (changed === false) {
      record(step("overflow", "skipped", "no front-end change"));
      record(step("lighthouse", "skipped", "no front-end change"));
    } else if (changed === undefined) {
      record(step("overflow", "not run", "the change test failed"));
      record(step("lighthouse", "not run", "the change test failed"));
    } else if (!serving) {
      record(step("overflow", "not run", notServing));
      record(step("lighthouse", "not run", notServing));
    } else {
      // overflow: real fonts, the phone project, live mode, as deploy.yml; hard here (P-1936 is a runner stall).
      const overflow = await execute(
        "bunx",
        ["playwright", "test", "--project=phone", "--grep", "@overflow"],
        {
          env: childEnv({ E2E_TARGET: "url", E2E_BASE_URL: base, E2E_MODE: "live" }),
          out: join(raw, "overflow.out"),
          timeoutMs: 15 * MINUTE,
        },
      );
      const summary = overflow.lines.filter((line) => /^\s*\d+ (passed|failed|flaky)/.test(line));
      record(judged(overflow, "overflow", summary.map((line) => line.trim()).join(", ")));

      // lighthouse: CI's config (lighthouserc.json, the gate of the preview job), at most two attempts of the same
      // command, each bounded to 10 minutes, the url read inside each attempt (rulings H71, H71b).
      /** @type {Attempt[]} */
      const attempts = [];
      do {
        const n = String(attempts.length + 1);
        const urls = await execute(process.execPath, ["scripts/lhci-urls.mjs", base], {
          env: childEnv({}),
          out: join(raw, `lhci-urls-${n}.out`),
          timeoutMs: MINUTE,
        });
        if (urls.code !== 0) {
          attempts.push({ ...urls, label: "scripts/lhci-urls.mjs" });
        } else {
          const urlArgs = lhciUrlArgs(urls.stdout);
          const lighthouse = await execute("bun", ["run", "lhci", "--", ...urlArgs], {
            env: childEnv({}),
            out: join(raw, `lighthouse-${n}.out`),
            timeoutMs: 10 * MINUTE,
          });
          attempts.push({
            ...lighthouse,
            label: `lighthouserc.json, ${String(urlArgs.length)} urls`,
          });
        }
        if (lighthouseRetry(attempts)) {
          process.stdout.write(
            "preview-local: lighthouse attempt 1 did not finish, retried (ruling H71)\n",
          );
        }
      } while (lighthouseRetry(attempts));
      record(lighthouseStep(attempts));
    }
  } finally {
    stop();
    // workerd lets go of its state files a moment after taskkill: an rmSync at once threw EPERM and the log was never
    // written (the first real run, 2026-10-08). The folder is in the temp dir, so a leftover is only noted.
    try {
      rmSync(persist, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error);
      process.stdout.write(`preview-local: ${persist} left behind (${why})\n`);
    }
  }

  const run = { pr, head, tree, date: stamp(new Date()), port, mode, steps };
  mkdirSync(join(ROOT, LOG_DIR), { recursive: true });
  const path = `${LOG_DIR}/pr-${pr}-${head.slice(0, 7)}.md`;
  writeFileSync(join(ROOT, path), renderLog(run));
  const hard = steps.filter(
    (done) =>
      done.verdict === "fail" || (done.verdict === "not run" && done.name !== "observatory"),
  );
  process.stdout.write(
    `preview-local: ${hard.length === 0 ? "every hard step passed" : `${String(hard.length)} hard steps did not pass`}\n`,
  );
  process.stdout.write(`${path}\n`);
  return hard.length === 0 ? 0 : 1;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  if (typeof args === "string") {
    process.stdout.write(`${args}\n`);
    process.exit(64);
  }
  process.exitCode = await main(args);
}
