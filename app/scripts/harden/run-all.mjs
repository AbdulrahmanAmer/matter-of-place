// `node scripts/harden/run-all.mjs --env dev|prod-config|prod [--only H1-16,H1-17] [--report] [--list] [--checklist <file>]`
// H1's runner: reads checklist.json, runs every automated row in order under Git Bash from the app folder and prints one
// table line per row (item, result, evidence). Results: pass, fail, blocked, blocked-on-L1, signed. Only `fail` changes
// the exit code. The runner never edits the checklist. The report keeps, for each row, its command, exit code and the
// first 40 lines of its output. `--env prod` runs the rows marked `blockedOn: "L1"` live against the custom domain.
//
// Placeholders in a command: <dev> (H1_DEV_URL, default http://localhost:8080), <prod-config> (H1_PROD_CONFIG_URL, else
// the Worker of the env), <worker> (the Worker this runner started for the phase), <load-dev> and <load-ops> (load a
// profile of scripts/load-env.mjs into that row's shell only). A phase with `worker` gets the built Worker on its port
// (HARDEN_PORT_<port> moves it when a lane uses another one); the runner stops it by its own process id.
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import net from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { z } from "zod";

const APP = fileURLToPath(new URL("../../", import.meta.url));
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const DEFAULT_CHECKLIST = fileURLToPath(new URL("./checklist.json", import.meta.url));
const GIT_BASH = "C:\\Program Files\\Git\\bin\\bash.exe";
const BASH = existsSync(GIT_BASH) ? GIT_BASH : "bash";
const ROW_TIMEOUT_MS = 30 * 60_000;
const WORKER_WAIT_MS = 60_000;
const OUTPUT_LINES = 40;
const OUTPUT_CAP = 2_000_000;
const ENVS = ["dev", "prod-config", "prod"];
const LOAD = {
  dev: 'eval "$(node scripts/load-env.mjs --profile dev)"',
  ops: 'eval "$(node scripts/load-env.mjs --profile ops)"',
};
const WORKER_URL = {
  "prod-config": "https://matter-of-place.holy-meadow-4327.workers.dev",
  prod: "https://matterofplace.com",
};

const Worker = z.strictObject({
  port: z.number().int(),
  testScheduled: z.boolean().optional(),
  mopEnv: z.string().optional(),
});
const Phase = z.strictObject({ command: z.string().min(1), worker: Worker.optional() });
const Signed = z.strictObject({ by: z.string(), date: z.string() });
const Row = z.strictObject({
  id: z.string().min(1),
  lane: z.string().default(""),
  item: z.string().default(""),
  expectation: z.string().default(""),
  manual: z.boolean().default(false),
  blockedOn: z.literal("L1").optional(),
  blockedText: z.string().optional(),
  needsEnv: z.string().optional(),
  build: z.boolean().optional(),
  command: z.string().optional(),
  worker: Worker.optional(),
  phases: z.array(Phase).optional(),
  prodCommand: z.string().optional(),
  expectOutput: z.array(z.string()).optional(),
  signed: Signed.optional(),
});
const ManualItem = z.strictObject({
  id: z.string().min(1),
  item: z.string(),
  owner: z.string(),
  signed: Signed.optional(),
});
const Checklist = z.strictObject({
  rows: z.array(Row),
  manualItems: z.array(ManualItem).default([]),
});

/**
 * @typedef {z.infer<typeof Row>} RowSpec
 * @typedef {z.infer<typeof Phase>} PhaseSpec
 * @typedef {z.infer<typeof Worker>} WorkerSpec
 * @typedef {z.infer<typeof ManualItem>} ManualSpec
 * @typedef {{ dev: string, prodConfig: string }} Urls
 * @typedef {{ code: number, output: string }} Run
 * @typedef {{ status: string, output: string }} Verdict
 * @typedef {{ id: string, item: string, status: string, code: number | null, seconds: number, command: string, lines: string[], evidence: string }} Outcome
 */

/**
 * @param {string} message
 * @returns {never}
 */
function usage(message) {
  console.error(message);
  process.exit(64);
}

/**
 * @param {number} pid
 * @returns {boolean}
 */
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Stops the process tree of a child this runner started, by its own process id.
 * @param {import("node:child_process").ChildProcess} child
 */
function killTree(child) {
  if (child.pid === undefined || child.exitCode !== null) return;
  if (process.platform !== "win32") {
    process.kill(-child.pid, "SIGKILL");
    return;
  }
  const result = spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
    windowsHide: true,
  });
  if (result.status !== 0 && alive(child.pid))
    console.error(`taskkill ${String(child.pid)} exited ${String(result.status)}`);
}

/**
 * @param {string} command
 * @returns {import("node:child_process").ChildProcessWithoutNullStreams}
 */
function spawnBash(command) {
  return spawn(BASH, ["-c", command], {
    cwd: APP,
    env: process.env,
    windowsHide: true,
    detached: process.platform !== "win32",
  });
}

/**
 * @param {string} command
 * @returns {Promise<Run>}
 */
function runShell(command) {
  const child = spawnBash(command);
  let output = "";
  /** @param {Buffer} chunk */
  const collect = (chunk) => {
    if (output.length < OUTPUT_CAP) output += chunk.toString("utf8");
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);
  const timer = setTimeout(() => {
    output += `\ntimed out after ${String(ROW_TIMEOUT_MS / 1000)} s\n`;
    killTree(child);
  }, ROW_TIMEOUT_MS);
  return new Promise((done) => {
    child.on("error", (error) => {
      clearTimeout(timer);
      done({ code: 127, output: `${BASH}: ${error.message}` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      done({ code: code ?? 1, output });
    });
  });
}

/**
 * @param {number} port
 * @returns {Promise<boolean>}
 */
function listening(port) {
  return new Promise((done) => {
    const socket = net.connect({ port, host: "127.0.0.1" });
    socket.on("connect", () => {
      socket.destroy();
      done(true);
    });
    socket.on("error", () => {
      done(false);
    });
  });
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function pause(ms) {
  return new Promise((done) => setTimeout(done, ms));
}

/**
 * @param {number} port
 * @param {() => boolean} stopped
 * @returns {Promise<boolean>} true once `/` answers 200
 */
async function answers200(port, stopped) {
  const deadline = Date.now() + WORKER_WAIT_MS;
  while (Date.now() < deadline && !stopped()) {
    try {
      const response = await fetch(`http://127.0.0.1:${String(port)}/`, {
        signal: AbortSignal.timeout(2000),
      });
      if (response.status === 200) return true;
    } catch {
      // not listening yet: the loop ends at the deadline and the caller reports the timeout
    }
    await pause(1000);
  }
  return false;
}

/**
 * @param {number} port
 * @returns {Promise<boolean>} true when nothing listens on the port within 15 s
 */
async function portClosed(port) {
  for (let attempt = 0; attempt < 15; attempt += 1) {
    if (!(await listening(port))) return true;
    await pause(1000);
  }
  return false;
}

/** @type {Promise<Run> | undefined} */
let building;

/** @returns {Promise<Run>} */
function ensureBuilt() {
  building ??= runShell("bun run build");
  return building;
}

/** @returns {string} an empty string, or the BLOCKED line */
function writeDevVars() {
  const result = spawnSync("node", ["scripts/dev-vars.mjs"], { cwd: APP, encoding: "utf8" });
  if (result.status !== 0) {
    const lines = `${result.stdout}${result.stderr}`.trim().split("\n");
    return `BLOCKED .dev.vars: ${lines.find((line) => line.startsWith("Error:")) ?? lines.at(-1) ?? ""}`;
  }
  if (!/^SUPABASE_URL=/m.test(readFileSync(`${APP}.dev.vars`, "utf8"))) {
    return "BLOCKED .dev.vars: no SUPABASE_URL line";
  }
  return "";
}

/**
 * @param {string} name
 * @param {string} value
 */
function setDevVar(name, value) {
  const file = `${APP}.dev.vars`;
  const lines = readFileSync(file, "utf8")
    .replaceAll("\r", "")
    .split("\n")
    .filter((line) => line.trim() !== "" && !line.startsWith(`${name}=`));
  writeFileSync(file, `${[...lines, `${name}=${value}`].join("\n")}\n`);
}

/**
 * @param {string} command
 * @param {Urls} urls
 * @param {number | undefined} port
 * @returns {string}
 */
function expand(command, urls, port) {
  const text = command
    .replaceAll("<dev>", urls.dev)
    .replaceAll("<prod-config>", urls.prodConfig)
    .replaceAll("<load-dev>", LOAD.dev)
    .replaceAll("<load-ops>", LOAD.ops);
  return port === undefined
    ? text
    : text.replaceAll("<worker>", `http://127.0.0.1:${String(port)}`);
}

/**
 * @param {string} command
 * @param {WorkerSpec} spec
 * @param {Urls} urls
 * @param {number} port
 * @returns {Promise<Run>}
 */
async function serve(command, spec, urls, port) {
  if (spec.mopEnv !== undefined) setDevVar("MOP_ENV", spec.mopEnv);
  copyFileSync(`${APP}.dev.vars`, `${APP}.output/server/.dev.vars`);
  const flags = spec.testScheduled === true ? " --test-scheduled" : "";
  const server = spawnBash(
    `bunx wrangler dev --config .output/server/wrangler.json${flags} --port ${String(port)}`,
  );
  let tail = "";
  /** @param {Buffer} chunk */
  const keep = (chunk) => {
    tail = `${tail}${chunk.toString("utf8")}`.slice(-4000);
  };
  server.stdout.on("data", keep);
  server.stderr.on("data", keep);
  /** @type {Run} */
  let result;
  try {
    const ready = await answers200(port, () => server.exitCode !== null);
    result = ready
      ? await runShell(expand(command, urls, port))
      : {
          code: 1,
          output: `the Worker on port ${String(port)} did not answer 200 in ${String(WORKER_WAIT_MS / 1000)} s\n${tail}`,
        };
  } finally {
    killTree(server);
  }
  if (await portClosed(port)) return result;
  return {
    code: 1,
    output: `${result.output}\nport ${String(port)} still listens after the Worker was stopped`,
  };
}

/**
 * Runs one command against the built Worker it starts and stops; `.dev.vars` is written again afterwards when the
 * phase changed MOP_ENV in it.
 * @param {string} command
 * @param {WorkerSpec} spec
 * @param {Urls} urls
 * @returns {Promise<Run>}
 */
async function runWithWorker(command, spec, urls) {
  const port = Number(process.env[`HARDEN_PORT_${String(spec.port)}`] ?? spec.port);
  const built = await ensureBuilt();
  if (built.code !== 0)
    return { code: built.code, output: `bun run build failed\n${built.output}` };
  if (await listening(port)) {
    return { code: 1, output: `port ${String(port)} is in use; stop its owner and run again` };
  }
  const blocked = writeDevVars();
  if (blocked !== "") return { code: 0, output: blocked };
  let restored = "";
  /** @type {Run} */
  let result;
  try {
    result = await serve(command, spec, urls, port);
  } finally {
    if (spec.mopEnv !== undefined) restored = writeDevVars();
  }
  return restored === "" ? result : { code: 1, output: `${result.output}\n${restored}` };
}

/**
 * @param {RowSpec} row
 * @param {string} env
 * @returns {PhaseSpec[]}
 */
function phasesOf(row, env) {
  if (env === "prod" && row.prodCommand !== undefined) return [{ command: row.prodCommand }];
  if (row.phases !== undefined) return row.phases;
  if (row.command === undefined) return [];
  return [{ command: row.command, ...(row.worker === undefined ? {} : { worker: row.worker }) }];
}

/**
 * @param {string} output
 * @returns {string[]}
 */
function linesOf(output) {
  return output.replaceAll("\r", "").split("\n");
}

/**
 * A loader may print a notice before a row's own BLOCKED line, so the verdict looks at every line.
 * @param {string} line
 * @returns {boolean}
 */
function isBlockedLine(line) {
  return line.startsWith("BLOCKED");
}

/**
 * @param {string} status
 * @param {string[]} lines
 * @returns {string}
 */
function evidenceOf(status, lines) {
  const filled = lines.filter((line) => line.trim() !== "");
  const picked = status.startsWith("blocked")
    ? (filled.find(isBlockedLine) ?? filled[0])
    : filled.at(-1);
  return (picked ?? "no output").trim().slice(0, 110);
}

/**
 * @param {RowSpec} row
 * @param {string} env
 * @param {Run} run
 * @returns {Verdict}
 */
function classify(row, env, run) {
  const awaitsL1 = row.blockedOn === "L1" && env !== "prod";
  if (run.code !== 0) return { status: "fail", output: run.output };
  if (linesOf(run.output).some(isBlockedLine)) {
    return { status: awaitsL1 ? "blocked-on-L1" : "blocked", output: run.output };
  }
  const missing = (row.expectOutput ?? []).filter(
    (pattern) => !new RegExp(pattern, "m").test(run.output),
  );
  if (missing.length > 0) {
    return { status: "fail", output: `${run.output}\noutput lacks: ${missing.join(" | ")}` };
  }
  return { status: awaitsL1 ? "blocked-on-L1" : "pass", output: run.output };
}

/**
 * @param {RowSpec} row
 * @param {string} env
 * @param {PhaseSpec[]} phases
 * @param {Urls} urls
 * @returns {Promise<Verdict & { code: number }>}
 */
async function runPhases(row, env, phases, urls) {
  const needed = row.needsEnv;
  if (needed !== undefined && (process.env[needed] ?? "") === "") {
    return { status: "blocked", output: row.blockedText ?? `BLOCKED ${needed}`, code: 0 };
  }
  if (phases.length === 0) {
    const status = env === "prod" || row.blockedOn === undefined ? "blocked" : "blocked-on-L1";
    return { status, output: row.blockedText ?? "BLOCKED: the row has no command", code: 0 };
  }
  /** @type {Run} */
  let run = { code: 0, output: "" };
  if (row.build === true) {
    const built = await ensureBuilt();
    if (built.code !== 0)
      run = { code: built.code, output: `bun run build failed\n${built.output}` };
  }
  const outputs = [run.output];
  for (const phase of phases) {
    if (run.code !== 0) break;
    const next =
      phase.worker === undefined
        ? await runShell(expand(phase.command, urls, undefined))
        : await runWithWorker(phase.command, phase.worker, urls);
    outputs.push(next.output);
    run = { code: next.code, output: outputs.join("\n") };
  }
  return { ...classify(row, env, run), code: run.code };
}

/**
 * @param {RowSpec} row
 * @param {string} env
 * @param {Urls} urls
 * @returns {Promise<Outcome>}
 */
async function runRow(row, env, urls) {
  const started = Date.now();
  const phases = phasesOf(row, env);
  const { status, output, code } = await runPhases(row, env, phases, urls);
  const lines = linesOf(output);
  return {
    id: row.id,
    item: row.item,
    status,
    code,
    seconds: (Date.now() - started) / 1000,
    command: phases.map((phase) => expand(phase.command, urls, phase.worker?.port)).join("\n"),
    lines,
    evidence: `${code === 0 ? "" : `exit ${String(code)}: `}${evidenceOf(status, lines)}`,
  };
}

/**
 * A row or item that only a person can prove: `signed` once it carries initials and a date.
 * @param {{ id: string, item: string, signed?: z.infer<typeof Signed> | undefined }} entry
 * @param {string} owner
 * @returns {Outcome}
 */
function manualOutcome(entry, owner) {
  const signed = entry.signed;
  const text =
    signed === undefined
      ? `BLOCKED until signed by ${owner}`
      : `signed ${signed.by} ${signed.date}`;
  return {
    id: entry.id,
    item: entry.item,
    status: signed === undefined ? "blocked" : "signed",
    code: null,
    seconds: 0,
    command: "(signed by a person)",
    lines: [text],
    evidence: text,
  };
}

/**
 * @param {Outcome} outcome
 * @returns {string}
 */
function tableLine(outcome) {
  const cell = (/** @type {string} */ text) => text.replaceAll("|", "/");
  return `| ${outcome.id} | ${cell(outcome.item)} | ${outcome.status} | ${cell(outcome.evidence)} |`;
}

/**
 * @param {Outcome} outcome
 * @returns {string}
 */
function detail(outcome) {
  const shown = outcome.lines.slice(0, OUTPUT_LINES).join("\n").replaceAll("```", "'''");
  const exit = outcome.code === null ? "not run" : `exit ${String(outcome.code)}`;
  return [
    `### ${outcome.id} · ${outcome.item}`,
    "",
    `Result: ${outcome.status} (${exit}, ${outcome.seconds.toFixed(1)} s)`,
    "",
    "```sh",
    outcome.command.replaceAll("```", "'''"),
    "```",
    "",
    `First ${String(OUTPUT_LINES)} lines of output:`,
    "",
    "```",
    shown,
    "```",
    "",
  ].join("\n");
}

/**
 * @param {Outcome[]} outcomes
 * @returns {string}
 */
function summary(outcomes) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const { status } of outcomes) counts.set(status, (counts.get(status) ?? 0) + 1);
  return [...counts].map(([status, count]) => `${status} ${String(count)}`).join(", ");
}

/**
 * @param {string} env
 * @param {string[] | undefined} wanted
 * @param {Outcome[]} outcomes
 * @param {string} rowCount "<rows run> of <rows in the checklist>"
 * @returns {string} the report path
 */
function writeReport(env, wanted, outcomes, rowCount) {
  const date = new Date().toISOString().slice(0, 10);
  const head = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" });
  const path = `${ROOT}workspace/audits/harden-${date}.md`;
  const selection =
    wanted === undefined ? "every row of the env" : `${wanted.join(", ")} (partial)`;
  const text = [
    `# HARDEN report ${date}`,
    "",
    `Env: ${env}. Commit: ${head.stdout.trim()}. Selection: ${selection}.`,
    `Rows: ${rowCount}. Result: ${summary(outcomes)}.`,
    "",
    "| ID | Item | Result | Evidence |",
    "|---|---|---|---|",
    ...outcomes.map(tableLine),
    "",
    ...outcomes.map(detail),
  ].join("\n");
  writeFileSync(path, text);
  return path;
}

/**
 * @param {string} env
 * @param {boolean} report
 * @param {RowSpec[]} rows
 * @param {ManualSpec[]} manualItems
 * @param {string[] | undefined} wanted
 * @returns {Promise<number>}
 */
async function runSelected(env, report, rows, manualItems, wanted) {
  const dev = process.env["H1_DEV_URL"] ?? "http://localhost:8080";
  const workerUrl = env === "dev" ? dev : WORKER_URL[env === "prod" ? "prod" : "prod-config"];
  const urls = { dev, prodConfig: process.env["H1_PROD_CONFIG_URL"] ?? workerUrl };
  const selected = rows.filter((row) =>
    wanted === undefined ? env !== "prod" || row.blockedOn === "L1" : wanted.includes(row.id),
  );
  console.log("| ID | Item | Result | Evidence |\n|---|---|---|---|");
  /** @type {Outcome[]} */
  const outcomes = [];
  for (const row of selected) {
    const outcome = row.manual ? manualOutcome(row, "its owner") : await runRow(row, env, urls);
    outcomes.push(outcome);
    console.log(tableLine(outcome));
  }
  if (wanted === undefined && env !== "prod") {
    for (const item of manualItems) {
      const outcome = manualOutcome(item, item.owner);
      outcomes.push(outcome);
      console.log(tableLine(outcome));
    }
  }
  console.log(`\n${summary(outcomes)}`);
  if (report) {
    const rowCount = `${String(selected.length)} of ${String(rows.length)}`;
    console.log(`report: ${writeReport(env, wanted, outcomes, rowCount)}`);
  }
  return outcomes.some((outcome) => outcome.status === "fail") ? 1 : 0;
}

async function main() {
  const { values } = parseArgs({
    options: {
      env: { type: "string", default: "dev" },
      only: { type: "string" },
      report: { type: "boolean", default: false },
      list: { type: "boolean", default: false },
      checklist: { type: "string" },
    },
    strict: true,
  });
  const env = values.env;
  if (!ENVS.includes(env)) usage(`--env is one of ${ENVS.join(", ")}`);
  const file = values.checklist === undefined ? DEFAULT_CHECKLIST : resolve(values.checklist);
  const parsed = Checklist.safeParse(JSON.parse(readFileSync(file, "utf8")));
  if (!parsed.success) usage(`${file}: ${parsed.error.message}`);
  const { rows, manualItems } = parsed.data;
  const ids = rows.map((row) => row.id);
  const repeated = ids.find((id, index) => ids.indexOf(id) !== index);
  if (repeated !== undefined) usage(`${file}: id ${repeated} appears twice`);
  if (values.list) {
    for (const row of rows)
      console.log(`${row.id}\t${row.lane}\t${row.manual ? "manual" : "automated"}`);
    return 0;
  }
  const wanted = values.only?.split(",").map((id) => id.trim());
  const unknown = (wanted ?? []).filter((id) => !ids.includes(id));
  if (unknown.length > 0) usage(`--only names no row: ${unknown.join(", ")}`);
  return await runSelected(env, values.report, rows, manualItems, wanted);
}

process.exitCode = await main();
