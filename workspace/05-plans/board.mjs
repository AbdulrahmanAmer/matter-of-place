#!/usr/bin/env node
// The progress board. Reads the plans, the status table of PLAN.md, trace.json and the ledger
// progress.json on every request, so the page is never older than the files.
//
//   node workspace/05-plans/board.mjs            serve http://127.0.0.1:8790
//   node workspace/05-plans/board.mjs --port N   another port
//   node workspace/05-plans/board.mjs --check    print the numbers, exit 1 when the ledger is wrong
//
// What counts: a step is "accepted" only when progress.json says so, and the orchestrator writes it
// there after a fresh reviewer accepted the step and its proofs were re-run. Built is not accepted.
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
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
      const [when, subject] = git(path, ["log", "-1", "--format=%ct%x09%s"]).trim().split("\t");
      lanes.push({ path, branch, at: Number(when) * 1000, subject });
    }
  } catch {
    // git is not required for the numbers; the page says nothing about lanes when it fails
  }
  gitCache = { at: Date.now(), lanes };
  return lanes;
}

export function collect(now = new Date()) {
  const errors = [];
  const slices = readSlices();
  const ledger = JSON.parse(readFileSync(join(HERE, "progress.json"), "utf8"));
  const trace = JSON.parse(readFileSync(join(HERE, "trace.json"), "utf8"));
  const byId = new Map(slices.map((s) => [s.id, s]));

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
    for (const step of slice.steps) {
      step.state = accepted.has(step.id) ? "accepted" : inReview.has(step.id) ? "in review" : "not started";
    }
    slice.note = entry.note ?? "";
    slice.total = slice.steps.length;
    slice.accepted = slice.steps.filter((s) => s.state === "accepted").length;
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
    if (slice.total > 0 && slice.state !== slice.planStatus) {
      errors.push(`${slice.id}: PLAN.md says "${slice.planStatus}", the ledger gives "${slice.state}"`);
    }
  }

  const counted = slices.filter((s) => s.total > 0);
  const total = counted.reduce((sum, s) => sum + s.total, 0);
  const accepted = counted.reduce((sum, s) => sum + s.accepted, 0);
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
    overall: {
      total,
      accepted,
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
    errors: [...new Set(errors)],
  };
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

export function render(data, auto) {
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
      : `Pace so far: ${o.accepted} steps accepted in ${pace.hours} hours on one lane, about ${pace.hoursPerStep} hours a step. At that pace the remaining ${o.total - o.accepted} steps would take about ${pace.remainingHoursOneLane} hours on one lane. Phase 1 runs three lanes side by side; that pace is unproven.`;

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
              `<li class="${step.state.replace(" ", "-")}"><strong>Step ${esc(step.id)}, ${esc(step.state)}${step.waiting ? ", has a part that waits on an outside account" : ""}.</strong> ${esc(step.text)}</li>`,
          )
          .join("")}</ol></details>`,
    )
    .join("\n");
  const worktrees = data.worktrees.length
    ? `<ul>${data.worktrees
        .map(
          (w) =>
            `<li>Build lane <code>${esc(w.branch)}</code>: last commit ${esc(ago(w.at, now.getTime()))}: ${esc(w.subject)}</li>`,
        )
        .join("")}</ul>`
    : "<p>No build lane is open.</p>";
  const errors = data.errors.length
    ? `<section class="errors" role="alert"><h2>The ledger has ${data.errors.length} error${data.errors.length === 1 ? "" : "s"}</h2><ul>${data.errors.map((e) => `<li>${esc(e)}</li>`).join("")}</ul></section>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${auto ? `<meta http-equiv="refresh" content="${auto}">` : ""}
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
<p class="lead">${o.percent} percent complete: ${o.accepted} of ${o.total} steps are accepted, and ${o.inReview} more are built and in review. ${o.slicesClosed} of ${o.slices} slices are closed.</p>
<span class="bar big" aria-hidden="true"><span class="done" style="width:${pct(o.accepted, o.total)}%"></span><span class="review" style="width:${pct(o.inReview, o.total)}%"></span></span>
<p class="meta">Page made ${esc(clock)}. Ledger last written ${esc(data.updated)}. <a href="${auto ? "/" : "/?auto=60"}">${auto ? "Stop reloading every minute" : "Reload this page every minute"}</a>.</p>
${errors}

<h2>What is happening now</h2>
<p>${esc(data.now)}</p>
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
<p>A step counts as accepted only after a second model, in a fresh context, tried to refute it and accepted it, and the orchestrator re-ran its proofs. A step that is built but still under review counts as in review, not as done. Steps differ in size, so the percentage is a count of steps, not of hours.</p>
<p>The numbers come from four files in <code>workspace/05-plans</code>: the plan files (the steps), <code>PLAN.md</code> (the slice list), <code>trace.json</code> (the planned pieces) and <code>progress.json</code> (which steps are accepted). The page reads them again on every load. The same numbers as data: <a href="/data.json">data.json</a>.</p>
</main>
</body>
</html>`;
}

function summary(data) {
  const o = data.overall;
  return [
    `overall: ${o.accepted} of ${o.total} steps accepted (${o.percent}%), ${o.inReview} in review, ${o.slicesClosed} of ${o.slices} slices closed`,
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
      } else if (url.pathname === "/") {
        const seconds = Number(url.searchParams.get("auto"));
        const auto = Number.isInteger(seconds) && seconds >= 15 && seconds <= 3600 ? seconds : 0;
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
        response.end(render(collect(), auto));
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
