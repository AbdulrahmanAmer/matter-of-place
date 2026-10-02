#!/usr/bin/env node
// The progress board. Reads the plans, the status table of PLAN.md, trace.json and the ledger
// progress.json on every request, so the page is never older than the files.
//
//   node workspace/05-plans/board.mjs            serve http://127.0.0.1:8790
//   node workspace/05-plans/board.mjs --port N   another port
//   node workspace/05-plans/board.mjs --check    print the numbers, exit 1 when the ledger is wrong
//
// What counts: a step is accepted once a fresh reviewer accepted it. The page reads that from the
// journals of the build runs, so it moves without anyone typing. progress.json is the orchestrator's
// ledger: the steps whose proofs it re-ran itself. Built is not accepted.
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const STATUS_HEADER = "| Slice | Status | Closed on | Proof |";
const AREAS = {
  "public-site": "Website pages and components",
  "public-api": "Website forms and public API",
  admin: "Admin portal",
  data: "Database",
  "automation-engine": "Automation engine and jobs",
  "content-pipelines": "Content pipelines: images, captions, social",
  email: "Email and newsletter",
  "delivery-ops": "Deployment and operations",
  producers: "Code, tests and settings each slice writes",
  decisions: "Decisions carried into the build",
};
const FONTS = {
  "/fonts/jost.woff2": "brand/typography/jost/jost-variable.woff2",
  "/fonts/cormorant.woff2": "brand/typography/cormorant-garamond/cormorant-garamond-variable.woff2",
};

const pct = (part, whole) => (whole ? Math.round((part / whole) * 1000) / 10 : 0);
const numberOf = (stepId) => Number.parseInt(stepId, 10);

function shorten(text) {
  const plain = text.replace(/`/g, "").replace(/\s+/g, " ").trim();
  if (plain.length <= 150) return plain;
  const cut = plain.slice(0, 150);
  return `${cut.slice(0, cut.lastIndexOf(" "))} …`;
}

function readSlices() {
  const plan = readFileSync(join(HERE, "PLAN.md"), "utf8");
  const start = plan.indexOf(STATUS_HEADER);
  if (start < 0) throw new Error("PLAN.md: the status table was not found");
  const slices = [];
  for (const line of plan.slice(start).split("\n").slice(2)) {
    if (!line.startsWith("|")) break;
    const cells = line.split("|").map((cell) => cell.trim());
    const id = cells[1];
    const file = join(HERE, `${id}.md`);
    let title = id;
    let steps = [];
    if (existsSync(file)) {
      const text = readFileSync(file, "utf8");
      title = (text.match(/^# (.+)$/m)?.[1] ?? id).replace(/^\S+\s+[—-]\s+/, "");
      steps = (text.split(/^## Steps/m)[1] ?? "")
        .split(/^## /m)[0]
        .split("\n")
        .map((l) => l.match(/^(\d+[a-z]?)\. ([\s\S]*)$/))
        .filter(Boolean)
        .map((m) => ({ id: m[1], text: shorten(m[2]), waiting: /BLOCKED/.test(m[2]) }));
    }
    slices.push({ id, title, planStatus: cells[2], closedOn: cells[3], steps });
  }
  return slices;
}

let gitCache = { at: 0, lanes: [] };
function readLanes() {
  if (Date.now() - gitCache.at < 20_000) return gitCache.lanes;
  const lanes = [];
  try {
    const git = (dir, args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" });
    const blocks = git(ROOT, ["worktree", "list", "--porcelain"]).trim().split(/\n\n+/);
    for (const block of blocks) {
      const path = block.match(/^worktree (.+)$/m)?.[1];
      const branch = block.match(/^branch refs\/heads\/(.+)$/m)?.[1];
      if (!path || !branch || resolve(path) === ROOT) continue;
      const commits = git(path, ["log", "-5", "--format=%ct%x09%s"])
        .trim()
        .split("\n")
        .map((line) => {
          const [when, subject] = line.split("\t");
          return { at: Number(when) * 1000, subject };
        });
      lanes.push({ path, branch, commits });
    }
  } catch {
    // git is not required for the numbers; the page says nothing about lanes when it fails
  }
  gitCache = { at: Date.now(), lanes };
  return lanes;
}

/** "9-10", "3b and 4", "5b": the step ids of the plan a group's text names, in plan order. */
function expandSteps(text, slice) {
  const all = slice.steps.map((s) => s.id);
  const ids = new Set();
  for (const m of String(text).matchAll(/(\d+[a-z]?)(?:\s*(?:-|–|to)\s*(\d+[a-z]?))?/g)) {
    const from = all.indexOf(m[1]);
    const to = m[2] ? all.indexOf(m[2]) : from;
    if (from >= 0 && to >= from) for (const id of all.slice(from, to + 1)) ids.add(id);
  }
  return [...ids];
}

const KINDS = [
  [/^build$/, () => "Builder builds"],
  [/^close$/, () => "Builder closes the open defects of"],
  [/^fix(\d+)$/, (m) => `Builder, fix round ${m[1]} for`],
  [/^review(\d*)$/, (m) => `Reviewer, round ${m[1] || "1"}, checks`],
  [/^bank$/, () => "Gotcha bank entries added for"],
];

/**
 * The build workflow writes one journal per run under this project's Claude folder. Each line is an
 * agent that started or returned, so the journals say what was accepted without anyone typing it.
 * A later run overrules an earlier one on the same step.
 */
function readRuns(ledger, byId, now) {
  const auto = new Map();
  const runsSeen = [];
  try {
    const project = join(homedir(), ".claude", "projects", ROOT.replace(/[^A-Za-z0-9]/g, "-"));
    const since = new Date(ledger.started).getTime();
    const journals = [];
    for (const session of readdirSync(project)) {
      const runs = join(project, session, "subagents", "workflows");
      if (!existsSync(runs)) continue;
      for (const run of readdirSync(runs)) {
        const file = join(runs, run, "journal.jsonl");
        if (existsSync(file) && statSync(file).mtimeMs >= since) journals.push({ file, at: statSync(file).mtimeMs });
      }
    }
    journals.sort((a, b) => a.at - b.at);
    for (const journal of journals) {
      const lines = readFileSync(journal.file, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter(Boolean);
      const results = new Map(lines.filter((l) => l.type === "result").map((l) => [l.agentId, l.result ?? {}]));
      const named = { ...(ledger.runGroups ?? {}) };
      for (const result of results.values()) {
        for (const group of result.groups ?? []) named[group.id] = group.steps;
      }
      const groups = new Map();
      const runEvents = [];
      for (const line of lines) {
        if (line.type !== "started" || !line.label || line.label.startsWith("size:")) continue;
        const [kind, sliceId, groupId, stepText] = line.label.split(":");
        const slice = byId.get(sliceId);
        if (!slice) continue;
        const steps = expandSteps(stepText ?? named[groupId] ?? "", slice);
        if (!steps.length) continue;
        const result = results.get(line.agentId);
        const group = groups.get(groupId) ?? { slice, steps, accepted: false };
        groups.set(groupId, group);
        const isReview = kind.startsWith("review");
        if ((isReview && result?.verdict === "accept") || (kind === "bank" && result?.status === "done")) {
          group.accepted = true;
        }
        const words = KINDS.map(([re, say]) => (kind.match(re) ? say(kind.match(re)) : null)).find(Boolean) ?? kind;
        const outcome = !result
          ? "running now"
          : isReview
            ? result.verdict === "accept"
              ? "accepted"
              : `sent back with ${(result.defects ?? []).length} point${(result.defects ?? []).length === 1 ? "" : "s"} to fix`
            : kind === "bank"
              ? "done, the step is accepted"
              : result.status === "blocked"
                ? "stopped, it needs a ruling from the orchestrator"
                : "finished, goes to review";
        runEvents.push({
          text: `${words} ${slice.id} step${steps.length > 1 ? "s" : ""} ${steps.join(", ")}`,
          outcome,
          running: !result,
        });
      }
      for (const group of groups.values()) {
        for (const id of group.steps) {
          auto.set(`${group.slice.id}:${id}`, group.accepted ? "accepted" : "in review");
        }
      }
      if (runEvents.length) {
        const sliceIds = [...new Set([...groups.values()].map((g) => g.slice.id))].join(", ");
        runsSeen.push({ title: `Build run for ${sliceIds}`, lastActivity: journal.at, events: runEvents.reverse().slice(0, 10) });
      }
    }
  } catch {
    // no journals: the ledger alone decides
  }
  // Show every run written in the last two hours (lanes run side by side), or else the newest one.
  const fresh = runsSeen.filter((run) => now - run.lastActivity < 2 * 3_600_000);
  return { auto, runs: (fresh.length ? fresh : runsSeen.slice(-1)).reverse() };
}

export function collect(now = new Date()) {
  const errors = [];
  const slices = readSlices();
  const ledger = JSON.parse(readFileSync(join(HERE, "progress.json"), "utf8"));
  const trace = JSON.parse(readFileSync(join(HERE, "trace.json"), "utf8"));
  const byId = new Map(slices.map((s) => [s.id, s]));
  const runs = readRuns(ledger, byId, now.getTime());

  for (const id of Object.keys(ledger.slices)) {
    if (!byId.has(id)) errors.push(`progress.json names slice ${id}, which PLAN.md does not list`);
  }
  for (const slice of slices) {
    const entry = ledger.slices[slice.id] ?? {};
    const accepted = new Set(entry.accepted ?? []);
    const inReview = new Set(entry.inReview ?? []);
    const known = new Set(slice.steps.map((s) => s.id));
    for (const id of [...accepted, ...inReview]) {
      if (!known.has(id)) errors.push(`${slice.id}: progress.json names step ${id}, which the plan does not have`);
    }
    for (const id of accepted) {
      if (inReview.has(id)) errors.push(`${slice.id}: step ${id} is both accepted and in review`);
    }
    // The ledger is the orchestrator's own word (proofs re-run). The journals add, with no one
    // typing, what a reviewer accepted since and what is being built or reviewed right now.
    for (const step of slice.steps) {
      const seenInRun = runs.auto.get(`${slice.id}:${step.id}`);
      step.checked = accepted.has(step.id);
      step.state = step.checked
        ? "accepted"
        : seenInRun === "accepted"
          ? "accepted"
          : inReview.has(step.id) || seenInRun === "in review"
            ? "in review"
            : "not started";
    }
    slice.note = entry.note ?? "";
    slice.total = slice.steps.length;
    slice.accepted = slice.steps.filter((s) => s.state === "accepted").length;
    slice.unchecked = slice.steps.filter((s) => s.state === "accepted" && !s.checked).length;
    slice.inReview = slice.steps.filter((s) => s.state === "in review").length;
    slice.percent = pct(slice.accepted, slice.total);
    slice.state =
      slice.total === 0
        ? slice.planStatus
        : slice.accepted === slice.total
          ? "closed"
          : slice.accepted + slice.inReview > 0
            ? "in progress"
            : "not started";
    const ledgerState =
      accepted.size === slice.total ? "closed" : accepted.size + inReview.size > 0 ? "in progress" : "not started";
    if (slice.total > 0 && ledgerState !== slice.planStatus) {
      errors.push(`${slice.id}: PLAN.md says "${slice.planStatus}", the ledger gives "${ledgerState}"`);
    }
  }

  const counted = slices.filter((s) => s.total > 0);
  const total = counted.reduce((sum, s) => sum + s.total, 0);
  const accepted = counted.reduce((sum, s) => sum + s.accepted, 0);
  const unchecked = counted.reduce((sum, s) => sum + s.unchecked, 0);
  const inReview = counted.reduce((sum, s) => sum + s.inReview, 0);

  const seen = new Map();
  const lanes = ledger.lanes.map((lane) => {
    const row = { phase: lane.phase, lane: lane.lane, parts: [], total: 0, accepted: 0, inReview: 0 };
    for (const part of lane.parts) {
      const slice = byId.get(part.slice);
      if (!slice) {
        errors.push(`lane ${lane.lane}: slice ${part.slice} is not in PLAN.md`);
        continue;
      }
      const from = part.from ?? 0;
      const to = part.to ?? Number.MAX_SAFE_INTEGER;
      const steps = slice.steps.filter((s) => numberOf(s.id) >= from && numberOf(s.id) <= to);
      for (const step of steps) {
        const key = `${slice.id} step ${step.id}`;
        if (seen.has(key)) errors.push(`${key} is in two lanes: ${seen.get(key)} and ${lane.lane}`);
        seen.set(key, lane.lane);
      }
      row.parts.push(part.from === undefined ? slice.id : `${slice.id} steps ${part.from} to ${part.to}`);
      row.total += steps.length;
      row.accepted += steps.filter((s) => s.state === "accepted").length;
      row.inReview += steps.filter((s) => s.state === "in review").length;
    }
    row.percent = pct(row.accepted, row.total);
    return row;
  });
  for (const slice of counted) {
    for (const step of slice.steps) {
      if (!seen.has(`${slice.id} step ${step.id}`)) errors.push(`${slice.id} step ${step.id} is in no lane`);
    }
  }

  const areas = Object.entries(AREAS).map(([key, label]) => {
    const items = trace.filter((item) => item.dimension === key);
    const done = items.reduce((sum, item) => {
      if (item.plan === "exists") return sum + 1;
      const slice = byId.get(item.plan);
      return sum + (slice && slice.total ? slice.accepted / slice.total : 0);
    }, 0);
    return { key, label, pieces: items.length, percent: pct(done, items.length) };
  });
  for (const item of trace) {
    if (!(item.dimension in AREAS)) errors.push(`trace.json: area "${item.dimension}" has no label in board.mjs`);
  }

  const hours = (now.getTime() - new Date(ledger.started).getTime()) / 3_600_000;
  const pace = accepted > 0 && hours > 0 ? hours / accepted : null;
  return {
    generated: now.toISOString(),
    updated: ledger.updated,
    now: ledger.now,
    paceNote: ledger.paceNote ?? "",
    overall: {
      total,
      accepted,
      unchecked,
      inReview,
      percent: pct(accepted, total),
      slices: counted.length,
      slicesClosed: counted.filter((s) => s.state === "closed").length,
    },
    pace: {
      hours: Math.round(hours * 10) / 10,
      hoursPerStep: pace === null ? null : Math.round(pace * 10) / 10,
      remainingHoursOneLane: pace === null ? null : Math.round(pace * (total - accepted)),
    },
    lanes,
    slices,
    areas,
    waiting: ledger.waiting,
    worktrees: readLanes(),
    runs: runs.runs,
    errors: [...new Set(errors)],
  };
}

/** Changes when anything a reader would notice changes; the page reloads itself on a new value. */
export function versionOf(data) {
  const seen = {
    overall: data.overall,
    now: data.now,
    events: data.runs.map((run) => run.events),
    errors: data.errors,
    commits: data.worktrees.map((w) => w.commits[0]?.subject),
    steps: data.slices.map((s) => s.steps.map((step) => step.state)),
  };
  return createHash("sha1").update(JSON.stringify(seen)).digest("hex").slice(0, 12);
}

const esc = (value) =>
  String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function bar(done, review, whole) {
  const a = whole ? (done / whole) * 100 : 0;
  const b = whole ? (review / whole) * 100 : 0;
  return `<span class="bar" aria-hidden="true"><span class="done" style="width:${a.toFixed(1)}%"></span><span class="review" style="width:${b.toFixed(1)}%"></span></span>`;
}

function ago(ms, now) {
  const minutes = Math.max(0, Math.round((now - ms) / 60_000));
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 6) / 10;
  return `${hours} hours ago`;
}

export function render(data, version) {
  const o = data.overall;
  const now = new Date(data.generated);
  // The laptop's own clock with its offset from UTC written out: the shell here prints "EDT" for
  // Egypt Daylight Time, which reads as US Eastern (GOTCHAS P-130).
  const offset = -now.getTimezoneOffset() / 60;
  const clock = `${new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(now)}, laptop time (UTC${offset >= 0 ? "+" : ""}${offset})`;
  const pace = data.pace;
  const paceLine =
    pace.hoursPerStep === null
      ? "No step is accepted yet, so there is no pace to report."
      : `Pace so far: ${o.accepted} steps accepted in ${pace.hours} hours, about ${pace.hoursPerStep} hours a step. At that pace the remaining ${o.total - o.accepted} steps would take about ${pace.remainingHoursOneLane} hours. ${data.paceNote}`;

  const laneRows = data.lanes
    .map(
      (l) =>
        `<tr><th scope="row">${esc(l.phase)}: ${esc(l.lane)}</th><td>${esc(l.parts.join(", "))}</td><td class="num">${l.accepted} of ${l.total}</td><td class="num">${l.inReview}</td><td class="num">${l.percent}%</td><td>${bar(l.accepted, l.inReview, l.total)}</td></tr>`,
    )
    .join("\n");
  const sliceRows = data.slices
    .map((s) =>
      s.total
        ? `<tr><th scope="row"><a href="#slice-${esc(s.id)}">${esc(s.id)}</a></th><td>${esc(s.title)}</td><td class="num">${esc(s.state)}</td><td class="num">${s.accepted} of ${s.total}</td><td class="num">${s.inReview}</td><td class="num">${s.percent}%</td><td>${bar(s.accepted, s.inReview, s.total)}</td></tr>`
        : `<tr><th scope="row">${esc(s.id)}</th><td>${esc(s.note || s.title)}</td><td>${esc(s.state)}</td><td class="num">not counted</td><td class="num"></td><td class="num"></td><td></td></tr>`,
    )
    .join("\n");
  const areaRows = data.areas
    .map(
      (a) =>
        `<tr><th scope="row">${esc(a.label)}</th><td class="num">${a.pieces}</td><td class="num">${a.percent}%</td><td>${bar(a.percent, 0, 100)}</td></tr>`,
    )
    .join("\n");
  const details = data.slices
    .filter((s) => s.total)
    .map(
      (s) =>
        `<details id="slice-${esc(s.id)}"><summary>${esc(s.id)}, ${esc(s.title)}: ${s.accepted} of ${s.total} steps accepted, ${s.percent}%</summary><ol class="steps">${s.steps
          .map(
            (step) =>
              `<li class="${step.state.replace(" ", "-")}"><strong>Step ${esc(step.id)}, ${esc(step.state)}${step.state === "accepted" && !step.checked ? " by the reviewer, the orchestrator's re-run is pending" : ""}${step.waiting ? ", has a part that waits on an outside account" : ""}.</strong> ${esc(step.text)}</li>`,
          )
          .join("")}</ol></details>`,
    )
    .join("\n");
  const events = data.runs
    .map(
      (run) =>
        `<h3>${esc(run.title)}, newest first</h3><p class="meta">Its journal was last written ${esc(ago(run.lastActivity, now.getTime()))}.</p><ol class="events">${run.events
          .map((e) => `<li${e.running ? ' class="running"' : ""}>${esc(e.text)}: <strong>${esc(e.outcome)}</strong>.</li>`)
          .join("")}</ol>`,
    )
    .join("");
  const worktrees = data.worktrees.length
    ? data.worktrees
        .map(
          (w) =>
            `<h3>Latest commits in the build lane <code>${esc(w.branch)}</code></h3><ul>${w.commits
              .map((c) => `<li>${esc(ago(c.at, now.getTime()))}: ${esc(c.subject)}</li>`)
              .join("")}</ul>`,
        )
        .join("")
    : "<p>No build lane is open.</p>";
  const pending = o.unchecked
    ? ` ${o.unchecked} of the accepted steps ${o.unchecked === 1 ? "is" : "are"} accepted by the reviewer and still wait${o.unchecked === 1 ? "s" : ""} for the orchestrator's own re-run.`
    : "";
  const errors = data.errors.length
    ? `<section class="errors" role="alert"><h2>The ledger has ${data.errors.length} error${data.errors.length === 1 ? "" : "s"}</h2><ul>${data.errors.map((e) => `<li>${esc(e)}</li>`).join("")}</ul></section>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${o.percent}% · Matter of Place build</title>
<style>
@font-face { font-family: "Jost"; src: url("/fonts/jost.woff2") format("woff2"); font-weight: 100 900; font-display: swap; }
@font-face { font-family: "Cormorant Garamond"; src: url("/fonts/cormorant.woff2") format("woff2"); font-weight: 300 700; font-display: swap; }
:root { --bg: #F5F2EB; --ink: #11110F; --line: #C9C0B2; --soft: #575751; --mid: #8B877F; --panel: #EEEAE1; }
@media (prefers-color-scheme: dark) { :root { --bg: #11110F; --ink: #EEEAE1; --line: #575751; --soft: #C9C0B2; --mid: #8B877F; --panel: #1b1b18; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 17px/1.55 "Jost", "Segoe UI", system-ui, sans-serif; }
main { max-width: 1120px; margin: 0 auto; padding: 40px 20px 80px; }
h1, h2 { font-family: "Cormorant Garamond", Georgia, serif; font-weight: 500; line-height: 1.15; margin: 0; }
h1 { font-size: 44px; }
h2 { font-size: 30px; margin-top: 56px; padding-top: 20px; border-top: 1px solid var(--line); }
h3 { font-size: 17px; font-weight: 500; margin: 28px 0 0; }
.events { padding-left: 22px; }
.events li { margin: 6px 0; color: var(--soft); }
.events li.running, .events li strong { color: var(--ink); }
.events li strong { font-weight: 500; }
p { margin: 12px 0; max-width: 78ch; }
.lead { font-size: 21px; }
.figure { font-family: "Cormorant Garamond", Georgia, serif; font-size: 112px; line-height: 1; margin: 28px 0 4px; }
.meta { color: var(--soft); font-size: 15px; }
a { color: inherit; }
a:focus-visible, summary:focus-visible { outline: 2px solid var(--ink); outline-offset: 3px; }
.wrap { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; margin-top: 16px; font-size: 16px; }
caption { text-align: left; color: var(--soft); font-size: 15px; padding-bottom: 8px; }
th, td { text-align: left; padding: 10px 14px 10px 0; border-bottom: 1px solid var(--line); vertical-align: top; }
thead th { font-weight: 500; color: var(--soft); font-size: 14px; letter-spacing: 0.04em; text-transform: uppercase; }
tbody th { font-weight: 500; white-space: nowrap; }
.num { white-space: nowrap; font-variant-numeric: tabular-nums; }
.bar { display: flex; width: 160px; height: 8px; background: var(--line); margin-top: 9px; }
.bar .done { background: var(--ink); }
.bar .review { background: var(--mid); }
.bar.big { width: 100%; height: 12px; margin: 16px 0 8px; }
details { border-bottom: 1px solid var(--line); padding: 12px 0; }
summary { cursor: pointer; font-weight: 500; }
.steps { margin: 12px 0 4px; padding-left: 28px; list-style: none; }
.steps li { margin: 8px 0; color: var(--soft); }
.steps li.accepted { color: var(--ink); }
.steps li strong { font-weight: 500; color: var(--ink); }
.errors { border: 1px solid var(--ink); padding: 4px 20px 12px; margin-top: 28px; background: var(--panel); }
.errors h2 { border: 0; margin-top: 12px; padding-top: 0; }
code { font-family: ui-monospace, Consolas, monospace; font-size: 0.9em; }
ul { padding-left: 22px; }
</style>
</head>
<body>
<main>
<h1>Matter of Place build progress</h1>
<p class="figure" aria-hidden="true">${o.percent}%</p>
<p class="lead">${o.percent} percent complete: ${o.accepted} of ${o.total} steps are accepted, and ${o.inReview} more ${o.inReview === 1 ? "is" : "are"} being built or reviewed. ${o.slicesClosed} of ${o.slices} slices are closed.${pending}</p>
<span class="bar big" aria-hidden="true"><span class="done" style="width:${pct(o.accepted, o.total)}%"></span><span class="review" style="width:${pct(o.inReview, o.total)}%"></span></span>
<p class="meta" id="live" role="status">Page made ${esc(clock)}. It reloads by itself when a step, a review or a commit changes; nobody has to update it.</p>
${errors}

<h2>What is happening now</h2>
<p>${esc(data.now)}</p>
<p class="meta">The paragraph above is the orchestrator's note, last written ${esc(data.updated)}. Everything below it is read live from the build.</p>
${events}
${worktrees}
<p>${esc(paceLine)}</p>

<h2>By phase and lane</h2>
<div class="wrap"><table>
<caption>Phase 0 runs on one lane. Phase 1 opens three lanes side by side. Phase 2 is hardening and launch.</caption>
<thead><tr><th scope="col">Lane</th><th scope="col">Slices</th><th scope="col">Steps accepted</th><th scope="col">In review</th><th scope="col">Percent</th><th scope="col"><span aria-hidden="true">Bar</span></th></tr></thead>
<tbody>
${laneRows}
</tbody></table></div>

<h2>By slice</h2>
<div class="wrap"><table>
<caption>A slice is one plan file. Its steps are built in order. Each slice name links to its step list below.</caption>
<thead><tr><th scope="col">Slice</th><th scope="col">What it is</th><th scope="col">State</th><th scope="col">Steps accepted</th><th scope="col">In review</th><th scope="col">Percent</th><th scope="col"><span aria-hidden="true">Bar</span></th></tr></thead>
<tbody>
${sliceRows}
</tbody></table></div>

<h2>By area of the product</h2>
<div class="wrap"><table>
<caption>Every planned piece of the product belongs to one slice. An area's percentage is the share of its pieces that sit in accepted steps, weighted by how far each piece's slice has been accepted.</caption>
<thead><tr><th scope="col">Area</th><th scope="col">Planned pieces</th><th scope="col">Percent</th><th scope="col"><span aria-hidden="true">Bar</span></th></tr></thead>
<tbody>
${areaRows}
</tbody></table></div>

<h2>Waiting on you</h2>
<p>None of these holds the build back today.</p>
<ul>
${data.waiting.map((w) => `<li><strong>${esc(w.what)}.</strong> ${esc(w.why)}</li>`).join("\n")}
</ul>

<h2>Every step</h2>
${details}

<h2>How this is counted</h2>
<p>A step counts as accepted once a second model, in a fresh context, tried to refute it and accepted it. The page reads that from the build's own journal, so it moves the moment a review ends. The orchestrator then re-runs the step's proofs and writes the step into the ledger; a step still waiting for that re-run is marked as such. A step that is being built or reviewed is not counted as done. Steps differ in size, so the percentage is a count of steps, not of hours.</p>
<p>The numbers come from the plan files (the steps), <code>PLAN.md</code> (the slice list), <code>trace.json</code> (the planned pieces), <code>progress.json</code> (the ledger) and the journals of the build runs. The same numbers as data: <a href="/data.json">data.json</a>.</p>
</main>
<script>
// Ask the server every 15 seconds whether anything changed; reload only when it did.
const shown = ${JSON.stringify(version)};
setInterval(async () => {
  try {
    const answer = await fetch("/version", { cache: "no-store" });
    if (answer.ok && (await answer.text()) !== shown) location.reload();
  } catch {
    // the board is not running; keep the page as it is
  }
}, 15000);
</script>
</body>
</html>`;
}

function summary(data) {
  const o = data.overall;
  return [
    `overall: ${o.accepted} of ${o.total} steps accepted (${o.percent}%), ${o.unchecked} of them not yet re-run by the orchestrator, ${o.inReview} in review, ${o.slicesClosed} of ${o.slices} slices closed`,
    ...data.runs.flatMap((run) => run.events.slice(0, 3).map((e) => `${run.title}: ${e.text}: ${e.outcome}`)),
    ...data.lanes.map((l) => `lane ${l.phase} ${l.lane}: ${l.accepted} of ${l.total} (${l.percent}%)`),
    ...data.areas.map((a) => `area ${a.label}: ${a.pieces} pieces, ${a.percent}%`),
  ].join("\n");
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--check")) {
    const data = collect();
    console.log(summary(data));
    for (const error of data.errors) console.error(`error: ${error}`);
    console.log(data.errors.length ? `board: ${data.errors.length} error(s)` : "board: OK");
    process.exit(data.errors.length ? 1 : 0);
  }
  const at = args.indexOf("--port");
  const port = at >= 0 ? Number(args[at + 1]) : 8790;
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    try {
      if (url.pathname in FONTS) {
        const body = readFileSync(join(ROOT, FONTS[url.pathname]));
        response.writeHead(200, { "Content-Type": "font/woff2", "Cache-Control": "max-age=86400" });
        response.end(body);
      } else if (url.pathname === "/data.json") {
        response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
        response.end(JSON.stringify(collect(), null, 1));
      } else if (url.pathname === "/version") {
        response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
        response.end(versionOf(collect()));
      } else if (url.pathname === "/") {
        const data = collect();
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
        response.end(render(data, versionOf(data)));
      } else {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Not found");
      }
    } catch (error) {
      response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      response.end(`The board could not read its files: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(`board: http://127.0.0.1:${port}`);
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
