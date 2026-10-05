#!/usr/bin/env node
// Stall watch for the build runs: prints one line per agent that has gone silent, and one per run with no live agent.
//
//   node workspace/05-plans/stall-watch.mjs [--minutes 20] [--dir <workflows dir>] [--runs wf_a,wf_b]
//
// Why (operator, 2026-10-06, after P-509 cost two hours): a reviewer hung at 21:00 inside a loop of test replays and
// never returned; the run waited on it until 23:10, when a human noticed. Every agent of a run (size, build, review,
// fix, bank, merge, close) writes its transcript as it works, so a transcript that has not changed for twenty minutes
// is a stalled agent: an API call that never came back, a shell that never returned (P-515, P-712), or a loop with no
// output. A run whose journal lists a started agent with no result and no live transcript is the same thing seen from
// the other side. The watcher only reports; the orchestrator stops the run and relaunches it from its branch with a
// close-out for the interrupted group (P-510), which is a known 10-minute cost against an unknown wait.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};
const minutes = Number(opt("--minutes", "20"));
const dir = opt(
  "--dir",
  join(
    process.env.USERPROFILE ?? process.env.HOME ?? "",
    ".claude/projects/E--Matter-Of-Place/bdd9245b-a217-4a62-859d-18b11075b310/subagents/workflows",
  ),
);
const only = opt("--runs", "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const now = Date.now();
const ageMin = (path) => Math.round((now - statSync(path).mtimeMs) / 60000);

const runs = readdirSync(dir).filter((d) => d.startsWith("wf_") && (only.length === 0 || only.includes(d)));
const lines = [];
for (const run of runs) {
  const journalPath = join(dir, run, "journal.jsonl");
  let journal;
  try {
    journal = readFileSync(journalPath, "utf8");
  } catch {
    continue;
  }
  // A run that ended wrote its last result long ago and has nothing started: skip it unless --runs named it.
  const entries = journal
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  // An agent is live when it started and no result followed. A run resumed after a kill re-runs the interrupted
  // group with a new agent: the old "started" entry never gets a result, so a later result under the same label
  // (from any agent) also closes it.
  const labelOf = new Map();
  const started = new Map();
  for (const e of entries) {
    if (e.type === "started" && e.agentId) {
      labelOf.set(e.agentId, e.label ?? "");
      started.set(e.agentId, e.label ?? "");
    }
    if (e.type === "result" && e.agentId) {
      started.delete(e.agentId);
      const label = labelOf.get(e.agentId);
      for (const [id, l] of [...started]) if (label && l === label) started.delete(id);
    }
  }
  const journalAge = ageMin(journalPath);
  if (started.size === 0) {
    if (only.includes(run)) lines.push(`IDLE ${run}: no agent started since its last result ${String(journalAge)} min ago`);
    continue;
  }
  for (const [agentId, label] of started) {
    const transcript = join(dir, run, `agent-${agentId}.jsonl`);
    let age;
    try {
      age = ageMin(transcript);
    } catch {
      lines.push(`STALL ${run} ${label} (${agentId}): started, no transcript yet, journal ${String(journalAge)} min old`);
      continue;
    }
    if (age >= minutes) lines.push(`STALL ${run} ${label} (${agentId}): transcript silent ${String(age)} min`);
  }
}
if (lines.length === 0) {
  if (args.includes("--verbose")) process.stdout.write(`stall-watch: ${String(runs.length)} runs read, nothing silent over ${String(minutes)} min\n`);
} else {
  process.stdout.write(`${lines.join("\n")}\n`);
}
