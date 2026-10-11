#!/usr/bin/env node
// Re-runs the recorded proof commands of accepted plan steps and writes one log (orchestrator job, 2026-10-11).
// Usage, from the repository root: node workspace/05-plans/rerun.mjs [list.json] [log]
//   list.json defaults to workspace/05-plans/rerun-2026-10-11.json: [{slice, step, cwd, command, writes, source?, note?}]
//   log defaults to workspace/05-plans/logs/rerun-2026-10-11.log (appended, never truncated)
// Every entry with writes=false runs once, in order, through Git Bash, with a 15-minute timeout; the dev profile of
// app/scripts/load-env.mjs is exported first (the proofs were recorded under it; RERUN_DEV_PROFILE=0 turns that off).
// Entries with writes=true are not run: their block says "SKIPPED needs quiet". The run ends with a summary table.
// It reads the database through the proofs' own test runners and never writes, deploys or sends on its own.
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const LIST = resolve(ROOT, process.argv[2] ?? "workspace/05-plans/rerun-2026-10-11.json");
const LOG = resolve(ROOT, process.argv[3] ?? "workspace/05-plans/logs/rerun-2026-10-11.log");
const TIMEOUT_MS = 15 * 60 * 1000;
const TAIL = 20;
const DEV_PROFILE = process.env.RERUN_DEV_PROFILE !== "0";
const BASH = ["C:/Program Files/Git/bin/bash.exe", "C:/Program Files/Git/usr/bin/bash.exe"].find((p) => existsSync(p)) ?? "bash";

const log = (text) => appendFileSync(LOG, text.endsWith("\n") ? text : `${text}\n`);

// A second fence behind the list's writes flag (P-3180): a command that matches one of these is skipped even when the
// list marks it writes=false, because an extractor can miss a writer and this run must never write, deploy or send.
const WRITERS = [
  /\bdb push\b|\bdb:push\b|\bdb:reset\b|\bdb-reset|\breseed\b|\bseed[-:]/i,
  /\bwrangler\b.*\b(deploy|secret|versions upload|delete)\b/i,
  /\bgit\s+(push|commit|merge|reset|rebase|checkout\s+--|clean|stash)\b/i,
  /\bgh\s+(pr\s+(create|merge|edit|ready|close|comment)|run\s+(rerun|cancel)|workflow\s+run|secret|api\s+-X\s*(POST|PATCH|PUT|DELETE))\b/i,
  /rollback-drill|restore-rehearsal|(retention|rotation|incident|fail|health)-drill|newsletter-test-send|EMAIL_LIVE=1|E2E_RESEND=1/i,
  /\brun-all\.mjs\b(?![^\n]*--only)/i,
  /\bcurl\b[^\n]*-X\s*(POST|PUT|PATCH|DELETE)/i,
  /<[^>\s]+>|^workflow_dispatch$/i, // a placeholder such as <key path> or a bare word is not a runnable command
];
const writerOf = (command) => WRITERS.find((re) => re.test(command));

function killTree(pid) {
  if (process.platform === "win32") spawnSync("taskkill", ["/T", "/F", "/PID", String(pid)], { stdio: "ignore" });
  else {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  }
}

function run(entry) {
  return new Promise((done) => {
    const appDir = resolve(ROOT, "app").replaceAll("\\", "/");
    const prelude = DEV_PROFILE ? `eval "$(cd '${appDir}' && node scripts/load-env.mjs --profile dev)"\n` : "";
    const started = Date.now();
    const child = spawn(BASH, ["-c", `${prelude}${entry.command}`], {
      cwd: entry.cwd && existsSync(entry.cwd) ? entry.cwd : ROOT,
      env: { ...process.env, MSYS_NO_PATHCONV: process.env.MSYS_NO_PATHCONV ?? "" },
      detached: process.platform !== "win32",
      windowsHide: true,
    });
    const lines = [];
    const keep = (chunk) => {
      for (const line of chunk.toString("utf8").replaceAll("\r", "").split("\n")) {
        // eslint-disable-next-line no-control-regex
        lines.push(line.replace(/\x1b\[[0-9;]*m/g, ""));
        if (lines.length > 400) lines.splice(0, lines.length - 400);
      }
    };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child.pid);
    }, TIMEOUT_MS);
    child.on("close", (code) => {
      clearTimeout(timer);
      const tail = lines.filter((l, i) => !(i === lines.length - 1 && l === "")).slice(-TAIL);
      done({ code: timedOut ? "timeout" : code, seconds: Math.round((Date.now() - started) / 1000), tail });
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      done({ code: "spawn-error", seconds: 0, tail: [String(error)] });
    });
  });
}

const parsed = JSON.parse(readFileSync(LIST, "utf8"));
const entries = Array.isArray(parsed) ? parsed : (parsed.entries ?? []);
const results = new Map(); // "slice step" -> pass | fail | skipped
const mark = (key, verdict) => {
  const before = results.get(key);
  if (before === "fail" || (before === "pass" && verdict === "skipped")) return;
  results.set(key, verdict);
};

log(`\n==== rerun ${new Date().toISOString()} | ${entries.length} entries | list ${LIST} | dev profile ${DEV_PROFILE ? "on" : "off"} ====`);
let index = 0;
for (const entry of entries) {
  index += 1;
  const key = `${entry.slice} ${entry.step}`;
  const head = `--- [${index}/${entries.length}] ${entry.slice} step ${entry.step} (${entry.source ?? "?"})\ncwd: ${entry.cwd}\ncommand: ${entry.command}`;
  if (!entry.command) {
    log(`${head}\nNO COMMAND${entry.note ? ` (${entry.note})` : ""}`);
    mark(key, "skipped");
    continue;
  }
  if (entry.writes) {
    log(`${head}\nSKIPPED needs quiet`);
    mark(key, "skipped");
    continue;
  }
  const writer = writerOf(entry.command);
  if (writer) {
    log(`${head}\nSKIPPED needs quiet (fence ${writer.source.slice(0, 60)})`);
    mark(key, "skipped");
    continue;
  }
  const outcome = await run(entry);
  log(`${head}\nexit: ${outcome.code}\nseconds: ${outcome.seconds}\n${outcome.tail.map((l) => `  | ${l}`).join("\n")}`);
  mark(key, outcome.code === 0 ? "pass" : "fail");
}

const rows = [...results.entries()];
const count = (v) => rows.filter(([, r]) => r === v).length;
log(`\n==== SUMMARY ${new Date().toISOString()} ====\n| slice | step | result |\n| --- | --- | --- |`);
for (const [key, verdict] of rows) {
  const [slice, ...step] = key.split(" ");
  log(`| ${slice} | ${step.join(" ")} | ${verdict} |`);
}
log(`steps: ${rows.length} | pass ${count("pass")} | fail ${count("fail")} | skipped ${count("skipped")}\n==== END ====`);
