// `node scripts/lhci-pages.mjs <baseUrl> [--config lighthouserc.json] [--bound-seconds 180] [--total-seconds 1200]
//   [--out-dir .lighthouseci-pages]`, run from `app/` (ruling H76). Lighthouse page by page: the urls of
// `scripts/lhci-urls.mjs`, then one `lhci autorun --config=<config> --collect.url=<url>` per url (the command of
// `bun run lhci` with one url, so the same runs and the same assertions), each bounded. A run that does not finish or fails
// only with a Lighthouse runtime error (the bound, a signal, `Runtime error encountered`, `NO_NAVSTART`, a protocol
// timeout, a failed collect run) is retried once; an assertion failure is never retried. The run stops at the first page
// that fails both attempts, and `--total-seconds` keeps it inside the workflow step's own limit; a page not run is a
// failure. Each attempt's whole output, and a copy of Lighthouse's own status log (`scripts/lhci-tee.mjs`; lhci keeps it in
// memory and loses it when a hung run is stopped), go to `--out-dir`; a failed attempt prints only its last 10 lines.
// Ruling H76a: every `lhr-*.json` of a page's passing attempt is copied into `<out-dir>/<n>-<slug>/` before the next
// page runs (lhci empties `.lighthouseci` at each start), so `scripts/perf-targets.mjs <out-dir>` reads all the pages.
// One line per url `lighthouse <url>: pass|fail (...)`, then a summary. Exit 0 only when every url passed, 1 otherwise,
// 64 on a usage error.
import { spawn, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { stripVTControlCharacters } from "node:util";

const USAGE =
  "usage: node scripts/lhci-pages.mjs <baseUrl> [--config lighthouserc.json] [--bound-seconds 180] [--total-seconds 1200] [--out-dir .lighthouseci-pages]";
export const DEFAULT_CONFIG = "lighthouserc.json";
/** A healthy page finishes its three runs in about 40 s on the runner; a hang never ends (coordinator, H76). */
const DEFAULT_BOUND = 180;
const DEFAULT_TOTAL = 1200;
const DEFAULT_OUT = ".lighthouseci-pages";
/** Where `lhci collect` leaves its reports (lighthouserc.json sets no outputDir); it empties this folder at each start. */
const REPORTS = ".lighthouseci";
/** The lines of a failed attempt printed to the log; the whole output stays in the out dir. */
export const TAIL_LINES = 10;
/** A url is not started with less than this left of the total: no Lighthouse run of a page finishes in less. */
const LEAST_SECONDS = 30;
/** After SIGINT (which lets chrome-launcher close Chrome), the group gets this long before SIGKILL. */
const GRACE_MS = 5_000;
const URL_LIST_MS = 60_000;

/**
 * @typedef {{ base: string, config: string, boundSeconds: number, totalSeconds: number, outDir: string }} Args
 * @typedef {{ code: number | null, signal: string | null, timedOut: boolean, output: string, seconds: number }} Attempt
 * @typedef {"pass" | "assertion" | "runtime" | "other"} Outcome
 * @typedef {{ url: string, passed: boolean, retried: boolean, line: string }} Verdict
 */

/**
 * @param {string[]} argv the arguments after the script name
 * @returns {Args | string} the arguments, or what is wrong with them
 */
export function parseArgs(argv) {
  const [base = "", ...flags] = argv;
  if (!/^https?:\/\/[^\s]+$/.test(base)) return USAGE;
  /** @type {Record<string, string>} */
  const given = {};
  for (let i = 0; i < flags.length; i += 2) {
    const flag = flags[i] ?? "";
    const value = flags[i + 1];
    const known = ["--config", "--bound-seconds", "--total-seconds", "--out-dir"];
    if (!known.includes(flag) || value === undefined) {
      return USAGE;
    }
    given[flag] = value;
  }
  const boundSeconds = Number(given["--bound-seconds"] ?? DEFAULT_BOUND);
  const totalSeconds = Number(given["--total-seconds"] ?? DEFAULT_TOTAL);
  if (!Number.isInteger(boundSeconds) || boundSeconds < LEAST_SECONDS) {
    return `${USAGE}\nbound ${String(boundSeconds)}`;
  }
  if (!Number.isInteger(totalSeconds) || totalSeconds < boundSeconds) {
    return `${USAGE}\ntotal ${String(totalSeconds)}`;
  }
  return {
    base: base.replace(/\/+$/, ""),
    config: given["--config"] ?? DEFAULT_CONFIG,
    boundSeconds,
    totalSeconds,
    outDir: given["--out-dir"] ?? DEFAULT_OUT,
  };
}

/**
 * The arguments of `lhci` for one url: with the default config this is `bun run lhci -- --collect.url=<url>`, plus
 * Lighthouse's status log at `info`, so the copy of a hung run shows where it stopped.
 * @param {string} config
 * @param {string} url
 * @returns {string[]}
 */
export function lhciArgs(config, url) {
  return [
    "autorun",
    `--config=${config}`,
    `--collect.url=${url}`,
    "--collect.settings.logLevel=info",
  ];
}

/**
 * A file name for a url's outputs: its path, letters and digits only.
 * @param {string} url
 * @returns {string}
 */
export function slugOf(url) {
  const path = new URL(url).pathname.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "");
  return path === "" ? "home" : path;
}

/**
 * Copies every `lhr-*.json` of `from` into `to` (made when missing), for `scripts/perf-targets.mjs` (ruling H76a).
 * @param {string} from the folder `lhci collect` wrote
 * @param {string} to the page's folder under the out dir
 * @returns {number} how many reports were copied; 0 when `from` is missing or holds none
 */
export function keepReports(from, to) {
  if (!existsSync(from)) return 0;
  const names = readdirSync(from).filter((name) => /^lhr-.*\.json$/.test(name));
  if (names.length === 0) return 0;
  mkdirSync(to, { recursive: true });
  for (const name of names) copyFileSync(join(from, name), join(to, name));
  return names.length;
}

/**
 * The last lines of a failed attempt for the log: Lighthouse's own status log when the run was stopped at its bound
 * (lhci printed nothing of it), otherwise lhci's output, which ends with the error or the failed assertions.
 * @param {Attempt} attempt
 * @param {string} lighthouseLog the copy of Lighthouse's stderr for this attempt
 * @returns {string[]}
 */
export function failureTail(attempt, lighthouseLog) {
  const source = attempt.timedOut && lighthouseLog.trim() !== "" ? lighthouseLog : attempt.output;
  return stripVTControlCharacters(source)
    .replaceAll("\r", "")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .slice(-TAIL_LINES);
}

/** What `lhci assert` (inside autorun) prints when an assertion fails; `@lhci/cli` 0.15 `assert.js` and `autorun.js`. */
const ASSERTION = /^(Assertion failed|assert command failed)\. Exiting with status code 1\.\r?$/m;
/** What a Lighthouse run that broke prints: `collect.js` writes `Run #<n>...failed!`, Lighthouse's CLI the rest. */
const RUNTIME = /Run #\d+\.\.\.failed!|Runtime error encountered|NO_NAVSTART|PROTOCOL_TIMEOUT/;

/**
 * @param {Attempt} attempt
 * @returns {Outcome}
 */
export function classify(attempt) {
  if (attempt.timedOut || attempt.signal !== null) return "runtime";
  if (attempt.code === 0) return "pass";
  if (ASSERTION.test(attempt.output)) return "assertion";
  if (RUNTIME.test(attempt.output)) return "runtime";
  return "other";
}

/**
 * Why a runtime failure happened, in a few words for the url line and the warning.
 * @param {Attempt} attempt
 * @returns {string}
 */
export function reason(attempt) {
  if (attempt.timedOut) return `stopped at its bound after ${String(attempt.seconds)} s`;
  if (attempt.signal !== null) return `ended by ${attempt.signal}`;
  const code = /\b(NO_NAVSTART|PROTOCOL_TIMEOUT)\b/.exec(attempt.output)?.[1];
  if (code !== undefined) return code;
  const run = /Run #(\d+)\.\.\.failed!/.exec(attempt.output)?.[1];
  if (run !== undefined) return `run #${run} failed`;
  return `exit ${String(attempt.code)}`;
}

/**
 * Ruling H76: only a runtime failure is tried again, and only once.
 * @param {Attempt[]} attempts the attempts of one url so far, in order
 * @returns {boolean}
 */
export function retryAfter(attempts) {
  const last = attempts.at(-1);
  return attempts.length === 1 && last !== undefined && classify(last) === "runtime";
}

/**
 * The verdict of one url from its attempts: none when the total had no room left for it, one, or two after a runtime
 * failure. A runtime failure with no second attempt is one the total had no room to retry.
 * @param {string} url
 * @param {Attempt[]} attempts
 * @param {number} totalSeconds
 * @returns {Verdict}
 */
export function verdict(url, attempts, totalSeconds) {
  const last = attempts.at(-1);
  const spent = `the total of ${String(totalSeconds)} s was spent`;
  if (last === undefined) {
    return {
      url,
      passed: false,
      retried: false,
      line: `lighthouse ${url}: fail (not run: ${spent})`,
    };
  }
  const retried = attempts.length > 1;
  const why = attempts.map(reason);
  const outcome = classify(last);
  /** @type {string} */
  let detail;
  if (outcome === "pass") detail = retried ? `pass (runtime, retried: ${why[0] ?? ""})` : "pass";
  else if (outcome === "assertion") {
    detail = retried
      ? `fail (assertion, after a runtime retry: ${why[0] ?? ""})`
      : "fail (assertion)";
  } else if (outcome === "runtime") {
    detail = retried
      ? `fail (runtime, retried: ${why.join("; ")})`
      : `fail (runtime: ${why[0] ?? ""}, not retried: ${spent})`;
  } else detail = `fail (${why.at(-1) ?? ""}, not a runtime error, not retried)`;
  return { url, passed: outcome === "pass", retried, line: `lighthouse ${url}: ${detail}` };
}

/**
 * The stop rule of H76: a page that failed both attempts ends the run, so a preview that hangs page after page costs
 * two bounds more, not twelve. An assertion failure (never retried) does not stop it.
 * @param {Verdict} one
 * @returns {boolean}
 */
export function stopsRun(one) {
  return one.retried && !one.passed;
}

/**
 * A url left out because an earlier page failed both attempts.
 * @param {string} url
 * @param {string} failed the url that stopped the run
 * @returns {Verdict}
 */
export function notRun(url, failed) {
  return {
    url,
    passed: false,
    retried: false,
    line: `lighthouse ${url}: fail (not run: ${failed} failed both attempts)`,
  };
}

/**
 * The summary line and the exit code: 0 only when there is at least one url and every url passed.
 * @param {Verdict[]} verdicts
 * @returns {{ line: string, code: number }}
 */
export function summary(verdicts) {
  const passed = verdicts.filter((one) => one.passed).length;
  const retried = verdicts.filter((one) => one.retried).length;
  const failed = verdicts.length - passed;
  return {
    line:
      `lighthouse: ${String(verdicts.length)} urls, ${String(passed)} passed, ${String(failed)} failed, ` +
      `${String(retried)} retried (ruling H76)`,
    code: verdicts.length > 0 && failed === 0 ? 0 : 1,
  };
}

/**
 * The GitHub Actions annotation for a retried url; a property value escapes `%`, `:` and `,` as the toolkit does.
 * @param {string} url
 * @param {string} why
 * @returns {string}
 */
export function warning(url, why) {
  const title = `lighthouse ${url} retried`
    .replaceAll("%", "%25")
    .replaceAll(":", "%3A")
    .replaceAll(",", "%2C");
  return `::warning title=${title}::${why}, retried once (ruling H76)`;
}

const URL_LINE = /^lighthouse (\S+): (pass|fail)(.*)$/gm;
const SUMMARY_LINE =
  /^lighthouse: (\d+) urls, (\d+) passed, (\d+) failed, (\d+) retried \(ruling H76\)$/m;

/**
 * Reads this script's own output back (scripts/preview-local.mjs does): the url lines and the summary.
 * @param {string} text
 * @returns {{ lines: string[], urls: number, passed: number, retried: number } | undefined} undefined without a summary
 */
export function readOutput(text) {
  const plain = text.replaceAll("\r", "");
  const counts = SUMMARY_LINE.exec(plain);
  if (counts === null) return undefined;
  return {
    // Each url line is printed twice, after its url and again above the summary.
    lines: [...new Set([...plain.matchAll(URL_LINE)].map(([line]) => line))],
    urls: Number(counts[1]),
    passed: Number(counts[2]),
    retried: Number(counts[4]),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The run itself: processes and time.

const APP = fileURLToPath(new URL("..", import.meta.url));
const LHCI = fileURLToPath(new URL("../node_modules/@lhci/cli/src/cli.js", import.meta.url));
const TEE = pathToFileURL(fileURLToPath(new URL("./lhci-tee.mjs", import.meta.url))).href;

/** @type {import("node:child_process").ChildProcess | undefined} */
let current;

/**
 * Stops a process and everything it started. On Linux SIGINT first, which Lighthouse's chrome-launcher answers by
 * closing Chrome (it runs Chrome in a group of its own), then SIGKILL for the rest of our group. On Windows the tree.
 * @param {import("node:child_process").ChildProcess} child
 */
function stopTree(child) {
  const { pid } = child;
  if (pid === undefined) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    return;
  }
  /** @param {NodeJS.Signals} signal */
  const send = (signal) => {
    try {
      process.kill(-pid, signal);
    } catch {
      // The group is gone.
    }
  };
  send("SIGINT");
  setTimeout(() => {
    send("SIGKILL");
  }, GRACE_MS).unref();
}

/**
 * Runs one node command to its end or its bound and keeps its whole output; nothing of it reaches our stdout.
 * @param {string[]} args the arguments of node
 * @param {number} timeoutMs
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Promise<Attempt>}
 */
function run(args, timeoutMs, env = process.env) {
  return new Promise((done) => {
    const started = Date.now();
    let output = "";
    let timedOut = false;
    let settled = false;
    const child = spawn(process.execPath, args, {
      cwd: APP,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      detached: process.platform !== "win32",
    });
    current = child;
    /** @param {Buffer} chunk */
    const take = (chunk) => {
      output += chunk.toString("utf8");
    };
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    /** @type {NodeJS.Timeout | undefined} */
    let fallback;
    /**
     * @param {number | null} code
     * @param {string | null} signal
     */
    const finish = (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(fallback);
      current = undefined;
      done({
        code,
        signal,
        timedOut,
        output: stripVTControlCharacters(output),
        seconds: Math.round((Date.now() - started) / 1000),
      });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      stopTree(child);
      // A grandchild that keeps a pipe open must not keep us waiting for `close`.
      fallback = setTimeout(() => {
        finish(null, "SIGKILL");
      }, 3 * GRACE_MS);
    }, timeoutMs);
    child.on("error", (error) => {
      output += `\n${error.message}\n`;
      finish(null, null);
    });
    child.on("close", finish);
  });
}

/**
 * @param {string} base
 * @returns {Promise<string[] | string>} the urls, or why there are none
 */
async function urlList(base) {
  /** @type {Attempt | undefined} */
  let last;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    // The url list reads the target's catalog, which can hang when the target does (H71b): it gets its own retry.
    last = await run(["scripts/lhci-urls.mjs", base], URL_LIST_MS);
    if (last.code === 0) {
      return last.output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => /^https?:\/\//.test(line));
    }
  }
  const lines = (last?.output ?? "").trim().split(/\r?\n/);
  return last?.timedOut === true ? "lhci-urls did not finish in 60 s" : (lines.at(-1) ?? "");
}

/**
 * One bounded lhci run of one url, its output and Lighthouse's status log kept under `dir`.
 * @param {{ config: string, url: string, bound: number, dir: string, name: string }} page
 * @returns {Promise<{ attempt: Attempt, lighthouseLog: string }>}
 */
async function attemptPage({ config, url, bound, dir, name }) {
  const tee = join(dir, `${name}.lighthouse.log`);
  writeFileSync(tee, "");
  const options = [process.env["NODE_OPTIONS"] ?? "", `--import=${TEE}`].join(" ").trim();
  const attempt = await run([LHCI, ...lhciArgs(config, url)], bound * 1000, {
    ...process.env,
    NODE_OPTIONS: options,
    LHCI_PAGES_TEE: tee,
  });
  writeFileSync(join(dir, `${name}.lhci.log`), attempt.output);
  return { attempt, lighthouseLog: existsSync(tee) ? readFileSync(tee, "utf8") : "" };
}

/** @param {Args} args */
async function main({ base, config, boundSeconds, totalSeconds, outDir }) {
  const deadline = Date.now() + totalSeconds * 1000;
  const dir = resolve(APP, outDir);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const urls = await urlList(base);
  if (typeof urls === "string") {
    process.stdout.write(`lighthouse: the url list failed twice: ${urls}\n`);
    return 1;
  }
  /** @type {Verdict[]} */
  const verdicts = [];
  /** @type {string | undefined} */
  let stoppedBy;
  for (const [index, url] of urls.entries()) {
    if (stoppedBy !== undefined) {
      verdicts.push(notRun(url, stoppedBy));
      continue;
    }
    /** @type {Attempt[]} */
    const attempts = [];
    do {
      const left = Math.floor((deadline - Date.now()) / 1000);
      if (left < LEAST_SECONDS) break;
      const bound = Math.min(boundSeconds, left);
      const n = attempts.length + 1;
      const name = `${String(index + 1)}-${slugOf(url)}-attempt${String(n)}`;
      process.stdout.write(
        `lhci-pages: ${url}, attempt ${String(n)} of 2, bound ${String(bound)} s\n`,
      );
      const { attempt, lighthouseLog } = await attemptPage({ config, url, bound, dir, name });
      attempts.push(attempt);
      if (classify(attempt) !== "pass") {
        const lines = failureTail(attempt, lighthouseLog).map((line) => `  | ${line}`);
        process.stdout.write(
          `lhci-pages: attempt ${String(n)}: ${classify(attempt)}, ${reason(attempt)}; ` +
            `last ${String(lines.length)} lines (whole output in ${outDir}/${name}.*.log):\n${lines.join("\n")}\n`,
        );
      }
      if (classify(attempt) === "pass") {
        const kept = keepReports(
          join(APP, REPORTS),
          join(dir, `${String(index + 1)}-${slugOf(url)}`),
        );
        process.stdout.write(`lhci-pages: kept ${String(kept)} reports of ${url} in ${outDir}\n`);
      }
      if (retryAfter(attempts)) process.stdout.write(`${warning(url, reason(attempt))}\n`);
    } while (retryAfter(attempts));
    const one = verdict(url, attempts, totalSeconds);
    verdicts.push(one);
    process.stdout.write(`${one.line}\n`);
    if (stopsRun(one)) stoppedBy = url;
  }
  const done = summary(verdicts);
  process.stdout.write(`\n${verdicts.map((one) => one.line).join("\n")}\n${done.line}\n`);
  return done.code;
}

/**
 * A cancelled step (the runner's SIGINT or SIGTERM) takes the running lhci, its Lighthouse and Chrome with it.
 * @param {number} code
 * @returns {() => never}
 */
const stopAndExit = (code) => () => {
  if (current !== undefined) stopTree(current);
  process.exit(code);
};

const invoked = resolve(process.argv[1] ?? ".") === fileURLToPath(import.meta.url);
if (invoked) {
  process.on("SIGINT", stopAndExit(130));
  process.on("SIGTERM", stopAndExit(143));
  const parsed = parseArgs(process.argv.slice(2));
  if (typeof parsed === "string") process.stdout.write(`${parsed}\n`);
  process.exitCode = typeof parsed === "string" ? 64 : await main(parsed);
}
