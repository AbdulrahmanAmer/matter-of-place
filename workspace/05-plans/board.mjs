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
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { collectRuns } from "./agent-cost.mjs";

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
// The arms of the product, as the operator names them. Every planned piece (trace.json) belongs to one arm
// through its area. An arm's own percentage weighs its pieces by how far the slice that builds each one has
// been accepted. Its percentage to launch adds the pieces of the arms it cannot work without (`needs`), so
// the database's progress counts toward the website and the admin portal, and the backend's toward both.
const ARMS = [
  { key: "website", label: "Website", what: "pages, forms, the public API they call, SEO, legal pages", dimensions: ["public-site", "public-api"], needs: ["database", "backend", "delivery"] },
  { key: "admin", label: "Admin portal", what: "screens, actions, roles and permissions", dimensions: ["admin"], needs: ["database", "backend", "delivery"] },
  { key: "backend", label: "Backend logic and automation", what: "jobs, recipes, cross-wiring, content pipelines, email", dimensions: ["automation-engine", "content-pipelines", "email"], needs: ["database", "delivery"] },
  { key: "database", label: "Database", what: "tables, functions, triggers, policies, migrations", dimensions: ["data"], needs: ["delivery"] },
  { key: "delivery", label: "Deployment and operations", what: "CI, deploys, backups, monitoring, the launch switch", dimensions: ["delivery-ops"], needs: [] },
];
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
    let dependsOn = [];
    if (existsSync(file)) {
      const text = readFileSync(file, "utf8");
      title = (text.match(/^# (.+)$/m)?.[1] ?? id).replace(/^\S+\s+[—-]\s+/, "");
      const depends = text.split("\n").find((line) => line.includes("Depends on:"))?.split("Depends on:")[1] ?? "";
      dependsOn = [...new Set([...depends.matchAll(/\b(B\d+b?|H1|L1)\b/g)].map((m) => m[1]).filter((dep) => dep !== id))];
      steps = (text.split(/^## Steps/m)[1] ?? "")
        .split(/^## /m)[0]
        .split("\n")
        .map((l) => l.match(/^(\d+[a-z]?)\. ([\s\S]*)$/))
        .filter(Boolean)
        .map((m) => ({ id: m[1], text: shorten(m[2]), waiting: /BLOCKED/.test(m[2]) }));
    }
    slices.push({ id, title, planStatus: cells[2], closedOn: cells[3], steps, dependsOn });
  }
  return slices;
}

// Cost per run from the build journals and transcripts (agent-cost.mjs); heavy to read, so at most every five minutes.
let costCache = { at: 0, runs: [] };
function readCosts() {
  if (Date.now() - costCache.at < 5 * 60_000) return costCache.runs;
  let runs = [];
  try {
    runs = collectRuns({ since: Date.now() - 14 * 86_400_000 }).filter((r) => r.stepsAccepted > 0).sort((x, y) => y.at - x.at).slice(0, 12);
  } catch {
    // no journals readable: the board says nothing about cost
  }
  costCache = { at: Date.now(), runs };
  return runs;
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
    const project = join(homedir(), ".claude", "projects", (process.env["BOARD_PROJECT_ROOT"] ?? ROOT).replace(/[^A-Za-z0-9]/g, "-"));
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
        // No agent of the build has run longer than 36 minutes; a journal silent for 45 is a stopped run.
        const stale = now - journal.at > 45 * 60_000;
        const outcome = !result
          ? stale
            ? "no result recorded: the run was stopped"
            : "running now"
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
          running: !result && !stale,
        });
      }
      for (const group of groups.values()) {
        for (const id of group.steps) {
          // Acceptance is never taken back by a later journal: a relaunch (a merge-only run, a resume that re-sizes a
          // done step) names the same steps without a review, and on 2026-10-08 that read as "in review" and the
          // board dropped three accepted B7 steps.
          const key = `${group.slice.id}:${id}`;
          if (auto.get(key) !== "accepted") auto.set(key, group.accepted ? "accepted" : "in review");
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
    // Steps the orchestrator recorded as waiting on the operator (an account or app only he can create). A
    // reviewer accepts a group as handed in, so the journal alone would count these; the ledger's word wins.
    const blocked = new Set(entry.blocked ?? []);
    const known = new Set(slice.steps.map((s) => s.id));
    for (const id of [...accepted, ...inReview, ...blocked]) {
      if (!known.has(id)) errors.push(`${slice.id}: progress.json names step ${id}, which the plan does not have`);
    }
    for (const id of accepted) {
      if (inReview.has(id)) errors.push(`${slice.id}: step ${id} is both accepted and in review`);
      if (blocked.has(id)) errors.push(`${slice.id}: step ${id} is both accepted and blocked`);
    }
    // The ledger is the orchestrator's own word (proofs re-run). The journals add, with no one
    // typing, what a reviewer accepted since and what is being built or reviewed right now.
    for (const step of slice.steps) {
      const seenInRun = runs.auto.get(`${slice.id}:${step.id}`);
      step.checked = accepted.has(step.id);
      step.state = step.checked
        ? "accepted"
        : blocked.has(step.id)
          ? "waiting on you"
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
    slice.blocked = slice.steps.filter((s) => s.state === "waiting on you").length;
    slice.percent = pct(slice.accepted, slice.total);
    slice.state =
      slice.total === 0
        ? slice.planStatus
        : slice.accepted === slice.total
          ? "closed"
          : slice.accepted + slice.inReview + slice.blocked > 0
            ? "in progress"
            : "not started";
    const ledgerState =
      accepted.size === slice.total
        ? "closed"
        : accepted.size + inReview.size + blocked.size > 0
          ? "in progress"
          : "not started";
    if (slice.total > 0 && ledgerState !== slice.planStatus) {
      errors.push(`${slice.id}: PLAN.md says "${slice.planStatus}", the ledger gives "${ledgerState}"`);
    }
  }

  const counted = slices.filter((s) => s.total > 0);
  const total = counted.reduce((sum, s) => sum + s.total, 0);
  const accepted = counted.reduce((sum, s) => sum + s.accepted, 0);
  const unchecked = counted.reduce((sum, s) => sum + s.unchecked, 0);
  const inReview = counted.reduce((sum, s) => sum + s.inReview, 0);
  // Steps that can only happen after go-live (ledger.postLaunch, operator 2026-10-11): the first paying property, the
  // week-one watch, the iterate loop, HSTS preload, the social channels and the audit robot's first Saturday. The
  // "to launch" figure leaves them out; the overall figure keeps every step.
  const postLaunch = ledger.postLaunch ?? {};
  const isPost = (sliceId, stepId) => (postLaunch[sliceId] ?? []).includes(stepId);
  const launchSteps = counted.flatMap((s) => s.steps.filter((step) => !isPost(s.id, step.id)));
  const launchTotal = launchSteps.length;
  const launchAccepted = launchSteps.filter((step) => step.state === "accepted").length;

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

  const pieceDone = (item) => {
    if (item.plan === "exists") return 1;
    const slice = byId.get(item.plan);
    return slice && slice.total ? slice.accepted / slice.total : 0;
  };
  const own = new Map(
    ARMS.map((arm) => {
      const items = trace.filter((item) => arm.dimensions.includes(item.dimension));
      return [arm.key, { pieces: items.length, done: items.reduce((sum, item) => sum + pieceDone(item), 0) }];
    }),
  );
  const arms = ARMS.map((arm) => {
    const path = new Set([arm.key]);
    for (const key of path) for (const need of ARMS.find((x) => x.key === key)?.needs ?? []) path.add(need);
    const pieces = [...path].reduce((sum, key) => sum + own.get(key).pieces, 0);
    const done = [...path].reduce((sum, key) => sum + own.get(key).done, 0);
    const mine = own.get(arm.key);
    return {
      key: arm.key,
      label: arm.label,
      what: arm.what,
      pieces: mine.pieces,
      ownPercent: pct(mine.done, mine.pieces),
      needs: [...path].filter((key) => key !== arm.key).map((key) => ARMS.find((x) => x.key === key).label),
      total: pieces,
      accepted: Math.round(done),
      remaining: Math.round(pieces - done),
      percent: pct(done, pieces),
    };
  });

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
      launchTotal,
      launchAccepted,
      launchPercent: pct(launchAccepted, launchTotal),
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
    arms,
    waiting: ledger.waiting,
    worktrees: readLanes(),
    costs: readCosts(),
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
    arms: data.arms.map((arm) => arm.percent),
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

/** A small mark for a state. Always printed beside the state's words, so colour and shape never carry it alone. */
function mark(kind) {
  const open = '<svg class="mk" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false">';
  const shapes = {
    accepted: '<circle cx="6" cy="6" r="5" fill="currentColor"/>',
    work: '<circle cx="6" cy="6" r="4.4" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M6 1.6a4.4 4.4 0 0 0 0 8.8z" fill="currentColor"/>',
    waiting: '<path d="M6 .9 11.1 6 6 11.1.9 6z" fill="none" stroke="currentColor" stroke-width="1.2"/>',
    none: '<circle cx="6" cy="6" r="4.4" fill="none" stroke="currentColor" stroke-width="1.2" stroke-dasharray="2 2"/>',
  };
  return `${open}${shapes[kind] ?? shapes.none}</svg>`;
}

const STEP_MARK = { accepted: "accepted", "in review": "work", "waiting on you": "waiting", "not started": "none" };
const STEP_WORDS = { accepted: "Accepted", "in review": "In work", "waiting on you": "Waiting on you", "not started": "Not started" };
const SLICE_MARK = { closed: "accepted", "in progress": "work", "not started": "none" };

function outcomeMark(outcome) {
  if (outcome.startsWith("running")) return "work";
  if (outcome.startsWith("accepted") || outcome.startsWith("done")) return "accepted";
  if (outcome.startsWith("finished")) return "work";
  return "waiting";
}

const ICONS = {
  overview: '<path d="M3 3h6v6H3zM11 3h6v6h-6zM3 11h6v6H3zM11 11h6v6h-6z"/>',
  arms: '<path d="M4 3v14M10 3v14M16 3v14"/>',
  lanes: '<path d="M3 5h14M3 10h14M3 15h14"/>',
  slices: '<path d="M3 4h14v3H3zM3 9h14v3H3zM3 14h9v3H3z"/>',
  steps: '<path d="M4 4l2 2 3-3M12 5h5M4 11l2 2 3-3M12 12h5"/>',
  activity: '<path d="M3 10h3l2-5 3 10 2-5h4"/>',
  waiting: '<circle cx="10" cy="10" r="7"/><path d="M10 6v4l3 2"/>',
  method: '<path d="M5 3h10v14H5zM8 7h4M8 10h4M8 13h2"/>',
};
const VIEWS = [
  ["overview", "Overview"],
  ["arms", "Arms"],
  ["lanes", "Lanes"],
  ["slices", "Slices"],
  ["steps", "Every step"],
  ["activity", "Activity"],
  ["waiting", "Waiting on you"],
  ["method", "How it is counted"],
];
const EMBLEM =
  '<svg class="emblem" viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" focusable="false"><path fill="currentColor" d="M3 2h7v20H3zM14 6h7v16h-7z"/></svg>';

/** The two typefaces as data in a snapshot, so the one static file asks the network for nothing. */
function embeddedFonts() {
  const face = (family, file, weights) => {
    try {
      const data = readFileSync(join(ROOT, file)).toString("base64");
      return `@font-face { font-family: "${family}"; src: url("data:font/woff2;base64,${data}") format("woff2"); font-weight: ${weights}; font-display: swap; }`;
    } catch {
      return "";
    }
  };
  return `${face("Jost", FONTS["/fonts/jost.woff2"], "100 900")}\n${face("Cormorant Garamond", FONTS["/fonts/cormorant.woff2"], "300 700")}`;
}

export function render(data, version, snapshot = false) {
  const o = data.overall;
  const now = new Date(data.generated);
  const pace = data.pace;
  const armRows = data.arms
    .map(
      (arm) =>
        `<tr><th scope="row">${esc(arm.label)}</th><td data-label="Covers">${esc(arm.what)}</td><td class="num" data-label="Pieces">${arm.pieces}</td><td class="num" data-label="Own">${arm.ownPercent}%</td><td data-label="Needs">${esc(arm.needs.join(", ") || "nothing else")}</td><td class="num" data-label="To go">${arm.remaining} of ${arm.total}</td><td class="num" data-label="To launch">${arm.percent}%</td><td class="barcell">${bar(arm.accepted, 0, arm.total)}</td></tr>`,
    )
    .join("\n");
  // The laptop's own clock with its offset from UTC written out: the shell here prints "EDT" for
  // Egypt Daylight Time, which reads as US Eastern (GOTCHAS P-130).
  const offset = -now.getTimezoneOffset() / 60;
  const clock = `${new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(now)}, laptop time (UTC${offset >= 0 ? "+" : ""}${offset})`;
  const paceLine =
    pace.hoursPerStep === null
      ? "No step is accepted yet, so there is no pace to report."
      : `Since the build began, ${pace.hours} hours ago, ${o.accepted} steps have been accepted: about ${pace.hoursPerStep} hours of the clock for each step, with every lane counted together. At that rate the remaining ${o.total - o.accepted} steps, the ones after go-live included, would take about ${pace.remainingHoursOneLane} more hours. It is a rate, not a date.`;

  const laneRows = data.lanes
    .map(
      (l) =>
        `<tr><th scope="row">${esc(l.phase)}: ${esc(l.lane)}</th><td data-label="Slices">${esc(l.parts.join(", "))}</td><td class="num" data-label="Accepted">${l.accepted} of ${l.total}</td><td class="num" data-label="In work">${l.inReview}</td><td class="num" data-label="Percent">${l.percent}%</td><td class="barcell">${bar(l.accepted, l.inReview, l.total)}</td></tr>`,
    )
    .join("\n");
  const sliceRows = data.slices
    .map((s) =>
      s.total
        ? `<tr><th scope="row"><a href="#slice-${esc(s.id)}">${esc(s.id)}</a></th><td data-label="What">${esc(s.title)}</td><td data-label="State"><span class="state">${mark(SLICE_MARK[s.state])}${esc(s.state)}</span></td><td class="num" data-label="Accepted">${s.accepted} of ${s.total}</td><td class="num" data-label="In work">${s.inReview}</td><td class="num" data-label="Percent">${s.percent}%</td><td class="barcell">${bar(s.accepted, s.inReview, s.total)}</td></tr>`
        : `<tr><th scope="row">${esc(s.id)}</th><td data-label="What">${esc(s.note || s.title)}</td><td data-label="State"><span class="state">${mark(SLICE_MARK[s.state])}${esc(s.state)}</span></td><td class="num" data-label="Accepted">not counted</td><td class="num"></td><td class="num"></td><td class="barcell"></td></tr>`,
    )
    .join("\n");
  const details = data.slices
    .filter((s) => s.total)
    .map(
      (s) =>
        `<details id="slice-${esc(s.id)}"><summary><span class="sum-id">${esc(s.id)}</span><span class="sum-title">${esc(s.title)}</span><span class="sum-count">${s.accepted} of ${s.total} accepted</span><span class="sum-pct">${s.percent}%</span><span class="chev" aria-hidden="true"></span><span class="sum-bar">${bar(s.accepted, s.inReview, s.total)}</span></summary><ol class="steps">${s.steps
          .map((step) => {
            const notes = [
              step.state === "accepted" && !step.checked ? "Accepted by the reviewer; the orchestrator's re-run is pending." : "",
              step.waiting ? "Has a part that waits on an outside account." : "",
            ]
              .filter(Boolean)
              .join(" ");
            return `<li class="${step.state.replaceAll(" ", "-")}"><span class="step-state">${mark(STEP_MARK[step.state])}<span class="sr">Step ${esc(step.id)}, </span>${esc(STEP_WORDS[step.state] ?? step.state)}</span><span class="step-id" aria-hidden="true">${esc(step.id)}</span><span class="step-text">${esc(step.text)}${notes ? `<em class="step-note">${esc(notes)}</em>` : ""}</span></li>`;
          })
          .join("")}</ol></details>`,
    )
    .join("\n");
  const events = data.runs
    .map(
      (run) =>
        `<section class="run"><h2>${esc(run.title)}</h2><p class="meta">Newest first. Its journal was last written ${esc(ago(run.lastActivity, now.getTime()))}.</p><ol class="timeline">${run.events
          .map(
            (e) =>
              `<li${e.running ? ' class="running"' : ""}>${mark(outcomeMark(e.outcome))}<span class="ev-text">${esc(e.text)}</span><strong class="ev-outcome">${esc(e.outcome)}</strong></li>`,
          )
          .join("")}</ol></section>`,
    )
    .join("");
  const worktrees = data.worktrees.length
    ? data.worktrees
        .map(
          (w) =>
            `<section class="run"><h3>Latest commits in the build lane <code>${esc(w.branch)}</code></h3><ol class="commits">${w.commits
              .map((c) => `<li><span class="when">${esc(ago(c.at, now.getTime()))}</span><span class="what">${esc(c.subject)}</span></li>`)
              .join("")}</ol></section>`,
        )
        .join("")
    : "<p>No build lane is open.</p>";
  const pending = o.unchecked
    ? ` ${o.unchecked} of the accepted steps ${o.unchecked === 1 ? "is" : "are"} accepted by the reviewer and still wait${o.unchecked === 1 ? "s" : ""} for the orchestrator's own re-run.`
    : "";
  const errors = data.errors.length
    ? `<section class="errors" role="alert"><h2>The ledger has ${data.errors.length} error${data.errors.length === 1 ? "" : "s"}</h2><ul>${data.errors.map((e) => `<li>${esc(e)}</li>`).join("")}</ul></section>`
    : "";
  const waitingSteps = data.slices.some((s) => s.steps.some((st) => st.state === "waiting on you"))
    ? `<h3>Steps recorded as waiting on you</h3><ol class="check">${data.slices
        .flatMap((s) => s.steps.filter((st) => st.state === "waiting on you").map((st) => `<li><span class="box" aria-hidden="true"></span><div><strong><a href="#slice-${esc(s.id)}">${esc(s.id)}</a>, step ${esc(st.id)}.</strong><p>${esc(st.text)}</p></div></li>`))
        .join("")}</ol>`
    : "";
  const nav = VIEWS.map(
    ([key, label], i) =>
      `<button type="button" data-view="${key}" title="${esc(label)}"${i === 0 ? ' aria-current="page"' : ""}><svg class="ico" viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="square" aria-hidden="true" focusable="false">${ICONS[key]}</svg><span class="lbl">${esc(label)}</span>${key === "waiting" && data.waiting.length ? `<span class="count lbl" aria-label="${data.waiting.length} items">${data.waiting.length}</span>` : ""}</button>`,
  ).join("\n");

  const css = `
:root { --bg: #F5F2EB; --ink: #11110F; --line: #C9C0B2; --soft: #575751; --mid: #8B877F; --panel: #EEEAE1; --side-w: 248px; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: #11110F; --ink: #EEEAE1; --line: #575751; --soft: #C9C0B2; --mid: #8B877F; --panel: #1b1b18; } }
:root[data-theme="dark"] { --bg: #11110F; --ink: #EEEAE1; --line: #575751; --soft: #C9C0B2; --mid: #8B877F; --panel: #1b1b18; }
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.55 "Jost", "Segoe UI", system-ui, sans-serif; }
a { color: inherit; text-underline-offset: 3px; text-decoration-thickness: 1px; }
button { font: inherit; color: inherit; }
button:focus-visible, a:focus-visible, summary:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.mk { flex: none; vertical-align: -1px; }

/* Shell: sidebar and page */
.shell { display: grid; grid-template-columns: var(--side-w) minmax(0, 1fr); min-height: 100vh; transition: grid-template-columns 0.2s ease; }
html[data-rail="1"] { --side-w: 72px; }
.side { border-right: 1px solid var(--line); padding: 24px 12px 16px; position: sticky; top: 0; height: 100vh; height: 100dvh; display: flex; flex-direction: column; gap: 24px; min-width: 0; overflow: hidden; background: var(--bg); }
.brand { display: flex; align-items: center; gap: 12px; padding: 0 8px; min-height: 44px; }
.emblem { flex: none; }
.brand-name { font-family: "Cormorant Garamond", Georgia, serif; font-size: 23px; line-height: 1.05; white-space: nowrap; }
.brand-name small { display: block; font: 12px/1.4 "Jost", system-ui, sans-serif; color: var(--soft); letter-spacing: 0.08em; text-transform: uppercase; margin-top: 3px; }
.side-top { display: flex; align-items: center; justify-content: space-between; gap: 4px; }
.drawer-close { display: none; }
nav { display: flex; flex-direction: column; gap: 2px; }
nav button { display: flex; align-items: center; gap: 14px; width: 100%; min-height: 44px; padding: 8px 10px; background: none; border: 0; border-left: 2px solid transparent; text-align: left; cursor: pointer; color: var(--soft); }
nav button:hover { color: var(--ink); background: var(--panel); }
nav button[aria-current="page"] { color: var(--ink); border-left-color: var(--ink); background: var(--panel); }
.ico { flex: none; }
.lbl { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.count { margin-left: auto; font-size: 13px; font-variant-numeric: tabular-nums; border: 1px solid var(--line); min-width: 24px; text-align: center; padding: 0 6px; line-height: 20px; color: var(--ink); }
.side-foot { margin-top: auto; display: flex; flex-direction: column; gap: 10px; }
.rail-toggle { display: flex; align-items: center; gap: 14px; min-height: 44px; padding: 8px 10px; background: none; border: 1px solid var(--line); cursor: pointer; color: var(--soft); width: 100%; text-align: left; }
.rail-toggle:hover { color: var(--ink); }
.rail-toggle .ico { transition: transform 0.2s ease; }
html[data-rail="1"] .rail-toggle .ico { transform: rotate(180deg); }
.side-meta { margin: 0; padding: 0 8px; color: var(--soft); font-size: 12.5px; line-height: 1.45; }
.topbar, .scrim { display: none; }
main { padding: 36px 40px 96px; max-width: 1180px; min-width: 0; }
@media (min-width: 821px) {
  html[data-rail="1"] .side { padding-left: 8px; padding-right: 8px; }
  html[data-rail="1"] .brand { justify-content: center; padding: 0; }
  html[data-rail="1"] .brand-name, html[data-rail="1"] .lbl, html[data-rail="1"] .side-meta { display: none; }
  html[data-rail="1"] nav button, html[data-rail="1"] .rail-toggle { justify-content: center; padding-left: 0; padding-right: 0; gap: 0; }
}

/* Type */
h1 { font-family: "Cormorant Garamond", Georgia, serif; font-weight: 500; font-size: 44px; line-height: 1.05; margin: 0 0 6px; letter-spacing: -0.005em; }
h2 { font-family: "Cormorant Garamond", Georgia, serif; font-weight: 500; font-size: 24px; line-height: 1.2; margin: 0 0 8px; }
h3 { font-size: 13px; font-weight: 500; letter-spacing: 0.08em; text-transform: uppercase; color: var(--soft); margin: 36px 0 10px; }
p { margin: 8px 0; }
.meta { color: var(--soft); font-size: 14.5px; }
.eyebrow { margin: 0 0 10px; font-size: 12px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--soft); }
.view-head { padding-bottom: 20px; border-bottom: 1px solid var(--line); margin-bottom: 8px; }
.view-head .meta { margin: 6px 0 0; max-width: 70ch; }
.view[hidden] { display: none; }
ul { padding-left: 20px; }
code { font-family: ui-monospace, Consolas, monospace; font-size: 0.88em; text-transform: none; letter-spacing: 0; }

/* Overview */
.hero { display: grid; grid-template-columns: minmax(0, auto) minmax(0, 1fr); gap: 20px 56px; align-items: center; padding: 36px 0 32px; border-bottom: 1px solid var(--line); }
.figure { font-family: "Cormorant Garamond", Georgia, serif; font-weight: 400; font-size: 136px; line-height: 0.85; margin: 0; letter-spacing: -0.02em; font-variant-numeric: lining-nums; }
.figure-label { margin: 14px 0 0; font-size: 13px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--soft); }
.hero-side { min-width: 0; }
.lead { font-size: 18.5px; line-height: 1.5; margin: 0 0 16px; max-width: 62ch; }
.facts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0; margin: 20px 0 0; border-top: 1px solid var(--line); }
.fact { padding: 14px 16px 0 0; }
.fact + .fact { padding-left: 16px; border-left: 1px solid var(--line); }
.fact dt { font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--soft); }
.fact dd { margin: 4px 0 0; font-family: "Cormorant Garamond", Georgia, serif; font-size: 34px; line-height: 1.05; font-variant-numeric: lining-nums; }
.fact dd small { font: 14px/1.3 "Jost", system-ui, sans-serif; color: var(--soft); display: block; margin-top: 2px; }
.sec { margin-top: 36px; }
.sec-head { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; margin-bottom: 12px; }
.sec-head h2 { margin: 0; }
.sec-head a { font-size: 14.5px; color: var(--soft); display: inline-flex; align-items: center; min-height: 44px; }
.arm-row { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); border: 1px solid var(--line); }
.arm { padding: 16px 16px 18px; min-width: 0; }
.arm + .arm { border-left: 1px solid var(--line); }
.arm h3 { margin: 0; text-transform: none; letter-spacing: 0; font-size: 15px; font-weight: 500; color: var(--ink); min-height: 2.9em; line-height: 1.45; }
.arm .big { font-family: "Cormorant Garamond", Georgia, serif; font-size: 48px; line-height: 1; margin: 6px 0 4px; font-variant-numeric: lining-nums; }
.arm .meta { margin: 0 0 12px; font-size: 13.5px; }
.now { border-top: 1px solid var(--ink); padding-top: 14px; }
.now p { font-family: "Cormorant Garamond", Georgia, serif; font-size: 21px; line-height: 1.45; margin: 0 0 8px; max-width: 72ch; }
.now .meta { font-family: "Jost", system-ui, sans-serif; font-size: 13.5px; }
.strip { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
.strip > * { padding: 18px 20px 18px 0; min-width: 0; color: inherit; text-decoration: none; display: block; }
.strip > * + * { padding-left: 20px; border-left: 1px solid var(--line); }
.strip a:hover .big { text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 6px; }
.strip h2 { font-size: 13px; font-family: "Jost", system-ui, sans-serif; font-weight: 500; letter-spacing: 0.08em; text-transform: uppercase; color: var(--soft); margin: 0; }
.strip .big { font-family: "Cormorant Garamond", Georgia, serif; font-size: 46px; line-height: 1; margin: 8px 0 4px; font-variant-numeric: lining-nums; }
.strip .meta { margin: 0; font-size: 14px; }

/* Bars: a hairline track, ink for accepted, warm grey for in work. The percent beside every bar is the real reading. */
.bar { display: flex; width: 140px; height: 6px; background: var(--line); }
.bar .done { background: var(--ink); }
.bar .review { background: var(--mid); }
.bar.big { width: 100%; height: 8px; margin: 8px 0 0; }
.bar.full { width: 100%; }

/* Tables */
.wrap { overflow-x: auto; margin-top: 8px; }
table { border-collapse: collapse; width: 100%; margin-top: 4px; font-size: 15px; }
th, td { text-align: left; padding: 12px 16px 12px 0; border-bottom: 1px solid var(--line); vertical-align: middle; }
thead th { font-weight: 500; color: var(--soft); font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; vertical-align: bottom; border-bottom-color: var(--ink); }
tbody th { font-weight: 500; }
.num { white-space: nowrap; font-variant-numeric: tabular-nums; }
.state { display: inline-flex; align-items: center; gap: 8px; white-space: nowrap; }
td a, th a { display: inline-block; padding: 6px 0; }

/* Every step */
.tools { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 20px; margin: 16px 0 4px; }
.tools button { min-height: 44px; padding: 0 16px; background: none; border: 1px solid var(--line); cursor: pointer; }
.tools button:hover { border-color: var(--ink); }
.legend { display: flex; flex-wrap: wrap; gap: 4px 18px; margin: 0; padding: 0; list-style: none; font-size: 13.5px; color: var(--soft); }
.legend li { display: inline-flex; align-items: center; gap: 7px; }
details { border-bottom: 1px solid var(--line); scroll-margin-top: 24px; }
summary { list-style: none; cursor: pointer; min-height: 56px; padding: 10px 0; display: grid; grid-template-columns: 52px minmax(0, 1fr) auto 52px 20px; align-items: center; column-gap: 14px; row-gap: 6px; }
summary::-webkit-details-marker { display: none; }
.sum-id { font-weight: 500; }
.sum-title { min-width: 0; }
.sum-count, .sum-pct { color: var(--soft); font-size: 14.5px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.sum-pct { text-align: right; }
.sum-bar { display: none; grid-column: 2 / -1; }
.sum-bar .bar { width: 100%; }
.chev { width: 8px; height: 8px; border-right: 1.3px solid currentColor; border-bottom: 1.3px solid currentColor; transform: rotate(45deg); justify-self: center; transition: transform 0.2s ease; margin-top: -3px; }
details[open] > summary .chev { transform: rotate(225deg); margin-top: 3px; }
.steps { margin: 0 0 14px 20px; padding: 0 0 0 20px; list-style: none; border-left: 1px solid var(--line); }
.steps li { display: grid; grid-template-columns: 150px 44px minmax(0, 1fr); column-gap: 14px; align-items: baseline; padding: 9px 0; font-size: 15px; color: var(--soft); }
.steps li + li { border-top: 1px solid var(--line); }
.steps li.accepted .step-text { color: var(--ink); }
.steps li.in-review, .steps li.waiting-on-you { color: var(--ink); }
.steps li.in-review .step-text, .steps li.waiting-on-you .step-text { color: var(--ink); }
.step-state { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; letter-spacing: 0.04em; text-transform: uppercase; white-space: nowrap; }
.step-id { font-variant-numeric: tabular-nums; color: var(--soft); font-size: 13.5px; }
.step-note { display: block; font-style: normal; font-size: 13.5px; color: var(--soft); margin-top: 3px; }

/* Activity */
.run { margin-top: 32px; }
.run h2 { font-size: 22px; margin: 0; }
.run h3 { margin-top: 0; }
.timeline { list-style: none; margin: 14px 0 0 6px; padding: 0; border-left: 1px solid var(--line); }
.timeline li { position: relative; padding: 0 0 18px 26px; color: var(--soft); }
.timeline li .mk { position: absolute; left: -6.5px; top: 6px; background: var(--bg); color: var(--ink); }
.timeline li.running { color: var(--ink); }
.ev-text, .ev-outcome { display: block; }
.ev-outcome { font-weight: 500; color: var(--ink); font-size: 14.5px; }
.commits { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--line); }
.commits li { display: grid; grid-template-columns: 150px minmax(0, 1fr); column-gap: 20px; padding: 9px 0; border-bottom: 1px solid var(--line); font-size: 15px; }
.commits .when { color: var(--soft); white-space: nowrap; }
.callout { border-top: 1px solid var(--ink); padding-top: 12px; margin-top: 12px; max-width: 70ch; }

/* Waiting on you */
.check { list-style: none; margin: 8px 0 0; padding: 0; border-top: 1px solid var(--line); }
.check li { display: grid; grid-template-columns: 28px minmax(0, 1fr); column-gap: 12px; padding: 18px 0; border-bottom: 1px solid var(--line); }
.check .box { width: 18px; height: 18px; border: 1.3px solid var(--ink); margin-top: 4px; }
.check strong { font-weight: 500; font-size: 17px; }
.check p { margin: 4px 0 0; color: var(--soft); max-width: 66ch; }

/* How it is counted */
.prose { max-width: 66ch; }
.prose p { font-size: 17px; line-height: 1.65; margin: 0 0 14px; }
.prose h2 { margin-top: 28px; }
.prose p:first-of-type { font-family: "Cormorant Garamond", Georgia, serif; font-size: 23px; line-height: 1.45; }
.errors { border: 1px solid var(--ink); padding: 4px 18px 10px; margin: 20px 0; background: var(--panel); }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }

/* Tablet and narrow desktop */
@media (max-width: 1100px) {
  main { padding: 28px 28px 80px; }
  .arm-row { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .arm:nth-child(odd) { border-left: 0; }
  .arm:nth-child(n+3) { border-top: 1px solid var(--line); }
  .arm + .arm { border-left: 1px solid var(--line); }
  .arm:nth-child(odd) { border-left: 0; }
  .hero { grid-template-columns: 1fr; }
}

/* Phone */
@media (max-width: 820px) {
  /* Phone (operator, 2026-10-07 and 2026-10-11). A top bar with the mark and a menu button; the views live in a drawer
     that slides from the left over a dimmed page. Every table turns into a list of labelled cards, one per row, so
     nothing is squeezed and nothing scrolls sideways. */
  .shell { display: block; }
  .topbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; position: sticky; top: 0; z-index: 20; height: 60px; padding: 0 8px 0 16px; background: var(--bg); border-bottom: 1px solid var(--line); }
  .topbar .brand { padding: 0; }
  .topbar .brand-name { font-size: 21px; }
  .menu-btn { display: inline-flex; align-items: center; gap: 10px; min-height: 44px; min-width: 44px; padding: 0 12px; background: none; border: 1px solid var(--line); cursor: pointer; }
  .side { position: fixed; z-index: 40; top: 0; left: 0; bottom: 0; width: min(86vw, 320px); height: auto; padding: 16px 12px 16px; transform: translateX(-100%); visibility: hidden; transition: transform 0.25s ease, visibility 0s linear 0.25s; border-right: 1px solid var(--line); overflow-y: auto; }
  .drawer-open .side { transform: none; visibility: visible; transition: transform 0.25s ease, visibility 0s; }
  .scrim { position: fixed; z-index: 30; inset: 0; background: rgba(17, 17, 15, 0.55); opacity: 0; pointer-events: none; transition: opacity 0.25s ease; border: 0; padding: 0; width: 100%; display: block; }
  .drawer-open .scrim { opacity: 1; pointer-events: auto; }
  .drawer-open { overflow: hidden; }
  .drawer-close { display: inline-flex; align-items: center; justify-content: center; width: 44px; height: 44px; background: none; border: 1px solid var(--line); cursor: pointer; flex: none; }
  .rail-toggle { display: none; }
  nav button { min-height: 48px; font-size: 17px; }
  main { padding: 20px 16px 64px; }
  h1 { font-size: 34px; }
  h2 { font-size: 22px; }
  .view-head { padding-bottom: 14px; }
  .hero { padding: 24px 0 22px; gap: 16px; }
  .figure { font-size: 108px; }
  .lead { font-size: 17px; }
  .facts { grid-template-columns: 1fr; border-top: 0; }
  .fact, .fact + .fact { padding: 12px 0; border-left: 0; border-top: 1px solid var(--line); display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
  .fact dd { margin: 0; text-align: right; font-size: 30px; }
  .fact dd small { display: inline; margin-left: 8px; }
  .arm-row { grid-template-columns: 1fr; border: 0; border-top: 1px solid var(--line); }
  .arm, .arm + .arm, .arm:nth-child(n) { border: 0; border-bottom: 1px solid var(--line); padding: 14px 0; display: grid; grid-template-columns: minmax(0, 1fr) auto; column-gap: 16px; align-items: center; }
  .arm h3 { min-height: 0; }
  .arm .big { grid-row: 1 / span 2; grid-column: 2; margin: 0; font-size: 40px; }
  .arm .meta { margin: 2px 0 8px; }
  .arm .bar { grid-column: 1 / -1; }
  .now p { font-size: 19px; }
  .strip { grid-template-columns: 1fr; border-top: 0; }
  .strip > *, .strip > * + * { padding: 14px 0; border-left: 0; border-top: 1px solid var(--line); display: grid; grid-template-columns: minmax(0, 1fr) auto; column-gap: 12px; align-items: center; min-height: 64px; }
  .strip h2 { grid-column: 1; }
  .strip .big { grid-column: 2; grid-row: 1 / span 2; margin: 0; font-size: 36px; }
  .strip .meta { grid-column: 1; }
  .wrap { overflow: visible; }
  .wrap table { display: block; font-size: 15px; margin-top: 4px; }
  .wrap thead { position: absolute; left: 0; top: 0; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  .wrap tbody { display: block; }
  .wrap tr { display: block; border: 1px solid var(--line); padding: 12px 14px 14px; margin-top: 12px; }
  .wrap tbody th { display: block; padding: 0 0 8px; margin-bottom: 4px; border: 0; border-bottom: 1px solid var(--line); font-size: 17px; white-space: normal; overflow-wrap: anywhere; }
  .wrap td { display: flex; gap: 12px; padding: 4px 0; border: 0; overflow-wrap: anywhere; }
  .wrap td::before { content: attr(data-label); color: var(--soft); flex: 0 0 38%; }
  .wrap tbody th a { display: inline-flex; align-items: center; min-width: 44px; min-height: 44px; margin: -12px 0 -12px; }
  .check a { display: inline-flex; align-items: center; min-height: 44px; min-width: 44px; margin: -10px 0; }
  .wrap td:not([data-label]):not(.barcell):not(.meta), .wrap td:empty { display: none; }
  .wrap td.barcell { display: block; padding-top: 8px; }
  .wrap td.barcell::before { display: none; }
  .wrap td.barcell .bar { width: 100%; }
  .wrap td.meta { display: block; }
  .tools button { flex: 1 1 140px; }
  summary { grid-template-columns: 40px minmax(0, 1fr) 20px; min-height: 60px; column-gap: 10px; }
  .sum-title { grid-column: 2; }
  .sum-count { grid-column: 2; grid-row: 2; font-size: 13.5px; }
  .sum-pct { display: none; }
  .chev { grid-column: 3; grid-row: 1 / span 2; }
  .sum-bar { display: block; grid-column: 2 / -1; grid-row: 3; }
  details { scroll-margin-top: 76px; }
  .steps { margin-left: 4px; padding-left: 14px; }
  .steps li { grid-template-columns: minmax(0, 1fr); row-gap: 4px; padding: 12px 0; }
  .step-id { display: none; }
  .commits li { grid-template-columns: 1fr; row-gap: 2px; }
  .timeline li { padding-bottom: 16px; }
  .check li { padding: 16px 0; }
  .steps li, .timeline li, p, summary, .commits li { overflow-wrap: anywhere; }
  .errors { padding: 4px 14px 10px; }
  code { overflow-wrap: anywhere; }
}
`;

  const script = `
// Remembered choices (view, rail) go through local storage when the browser allows it; a refusal changes nothing else.
const root = document.documentElement;
const views = [...document.querySelectorAll(".view")];
const buttons = [...document.querySelectorAll("nav button[data-view]")];
const side = document.getElementById("side");
const railToggle = document.getElementById("rail-toggle");
const menuBtn = document.getElementById("menu-btn");
const closeBtn = document.getElementById("drawer-close");
const scrim = document.getElementById("scrim");
const mainEl = document.getElementById("main");
const phone = window.matchMedia("(max-width: 820px)");

function setRail(on, save) {
  root.dataset.rail = on ? "1" : "0";
  railToggle.setAttribute("aria-expanded", String(!on));
  railToggle.setAttribute("aria-label", on ? "Expand the sidebar" : "Collapse the sidebar");
  railToggle.title = on ? "Expand the sidebar" : "Collapse the sidebar";
  if (save) { try { localStorage.setItem("board-rail", on ? "1" : "0"); } catch {} }
}
railToggle.addEventListener("click", () => setRail(root.dataset.rail !== "1", true));
setRail(root.dataset.rail === "1", false);

let drawerOpen = false;
function setDrawer(open, restore) {
  drawerOpen = open;
  document.body.classList.toggle("drawer-open", open);
  menuBtn.setAttribute("aria-expanded", String(open));
  mainEl.inert = open;
  if (open) {
    const current = side.querySelector('nav button[aria-current="page"]') || buttons[0];
    current.focus();
  } else if (restore) {
    menuBtn.focus();
  }
}
menuBtn.addEventListener("click", () => setDrawer(!drawerOpen, true));
closeBtn.addEventListener("click", () => setDrawer(false, true));
scrim.addEventListener("click", () => setDrawer(false, true));
document.addEventListener("keydown", (event) => {
  if (!drawerOpen) return;
  if (event.key === "Escape") { event.preventDefault(); setDrawer(false, true); return; }
  if (event.key !== "Tab") return;
  const items = [closeBtn, ...buttons];
  const first = items[0];
  const last = items[items.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  else if (!side.contains(document.activeElement)) { event.preventDefault(); first.focus(); }
});
phone.addEventListener("change", () => { if (!phone.matches && drawerOpen) setDrawer(false, false); });

// One view at a time; the choice lives in the address and, when the browser allows it, in local storage.
function show(name, hash) {
  if (!views.some((v) => v.id === "view-" + name)) name = "overview";
  for (const v of views) v.hidden = v.id !== "view-" + name;
  for (const b of buttons) b.dataset.view === name ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current");
  try { localStorage.setItem("board-view", name); } catch {}
  const want = hash || "#" + name;
  if (location.hash !== want) history.replaceState(null, "", want);
}
// A slice link (#slice-B7, from the Slices table) opens that slice in Every step and scrolls to it.
function route() {
  const hash = location.hash.slice(1);
  if (hash.startsWith("slice-")) {
    show("steps", "#" + hash);
    const slice = document.getElementById(hash);
    if (slice) { slice.open = true; slice.scrollIntoView({ block: "start" }); }
    return;
  }
  let name = hash;
  if (!name) { try { name = localStorage.getItem("board-view") || ""; } catch {} }
  show(name || "overview");
  window.scrollTo(0, 0);
}
for (const b of buttons) b.addEventListener("click", () => { show(b.dataset.view); window.scrollTo(0, 0); if (drawerOpen) setDrawer(false, true); });
for (const b of document.querySelectorAll("[data-fold]")) b.addEventListener("click", () => { for (const d of document.querySelectorAll("#view-steps details")) d.open = b.dataset.fold === "open"; });
window.addEventListener("hashchange", route);
route();
${snapshot ? "" : `const shown = ${JSON.stringify(version)};
setInterval(async () => {
  try {
    const answer = await fetch("/version", { cache: "no-store" });
    if (answer.ok && (await answer.text()) !== shown) location.reload();
  } catch {}
}, 15000);`}
`;

  const statusLine = snapshot ? `Snapshot taken ${esc(clock)}.` : `Reloads by itself when anything changes. ${esc(clock)}.`;
  const head = (id, title, meta) =>
    `<header class="view-head"><p class="eyebrow">Build board</p><h1 id="h-${id}">${title}</h1>${meta ? `<p class="meta">${meta}</p>` : ""}</header>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${snapshot ? "Build Progress Board" : `${o.percent}% · Matter of Place build`}</title>
<script>try { document.documentElement.dataset.rail = localStorage.getItem("board-rail") === "1" ? "1" : "0"; } catch { document.documentElement.dataset.rail = "0"; }</script>
<style>
${snapshot ? embeddedFonts() : '@font-face { font-family: "Jost"; src: url("/fonts/jost.woff2") format("woff2"); font-weight: 100 900; font-display: swap; }\n@font-face { font-family: "Cormorant Garamond"; src: url("/fonts/cormorant.woff2") format("woff2"); font-weight: 300 700; font-display: swap; }'}
${css}
</style>
</head>
<body>
<header class="topbar">
<div class="brand">${EMBLEM}<div class="brand-name">Matter of Place</div></div>
<button type="button" class="menu-btn" id="menu-btn" aria-expanded="false" aria-controls="side"><svg class="ico" viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="square" aria-hidden="true" focusable="false"><path d="M3 6h14M3 10h14M3 14h14"/></svg><span>Menu</span></button>
</header>
<button type="button" class="scrim" id="scrim" tabindex="-1" aria-label="Close the menu"></button>
<div class="shell">
<aside class="side" id="side" aria-label="Build board">
<div class="side-top">
<div class="brand">${EMBLEM}<div class="brand-name">Matter of Place<small>Build board</small></div></div>
<button type="button" class="drawer-close" id="drawer-close" aria-label="Close the menu"><svg class="ico" viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="square" aria-hidden="true" focusable="false"><path d="M4 4l12 12M16 4L4 16"/></svg></button>
</div>
<nav aria-label="Views">
${nav}
</nav>
<div class="side-foot">
<button type="button" class="rail-toggle" id="rail-toggle" aria-controls="side" aria-expanded="true" aria-label="Collapse the sidebar" title="Collapse the sidebar"><svg class="ico" viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="square" aria-hidden="true" focusable="false"><path d="M12 4l-6 6 6 6"/></svg><span class="lbl">Collapse</span></button>
<p class="side-meta">${snapshot ? `Snapshot, ${esc(clock)}` : `Live. ${esc(clock)}`}</p>
</div>
</aside>
<main id="main">
<section class="view" id="view-overview" aria-labelledby="h-overview">
${head("overview", "Overview", statusLine)}
${errors}
<div class="hero">
<div class="figures"><p class="figure" aria-hidden="true">${o.launchPercent}%</p><p class="figure-label">to launch</p></div>
<div class="hero-side"><p class="lead">${o.launchPercent} percent of the way to launch: ${o.launchAccepted} of ${o.launchTotal} launch steps accepted, ${o.launchTotal - o.launchAccepted} to go, ${o.inReview} in work. Overall ${o.percent} percent of ${o.total} steps, counting the ${o.total - o.launchTotal} that can only happen after go-live.${pending}</p>
<span class="bar big" aria-hidden="true"><span class="done" style="width:${pct(o.launchAccepted, o.launchTotal)}%"></span><span class="review" style="width:${pct(o.inReview, o.launchTotal)}%"></span></span>
<dl class="facts">
<div class="fact"><dt>Overall</dt><dd>${o.percent}%<small>${o.accepted} of ${o.total} steps</small></dd></div>
<div class="fact"><dt>To go to launch</dt><dd>${o.launchTotal - o.launchAccepted}<small>steps</small></dd></div>
<div class="fact"><dt>In work</dt><dd>${o.inReview}<small>steps</small></dd></div>
</dl></div>
</div>
<div class="sec"><div class="sec-head"><h2>The five arms</h2><a href="#arms">All arm detail</a></div>
<div class="arm-row">
${data.arms.map((arm) => `<div class="arm"><h3>${esc(arm.label)}</h3><p class="big">${arm.percent}%</p><p class="meta">to launch · own ${arm.ownPercent}% · ${arm.remaining} pieces to go</p><span class="bar full" aria-hidden="true"><span class="done" style="width:${arm.percent}%"></span></span></div>`).join("\n")}
</div></div>
<div class="sec now"><h2>Now</h2><p>${esc(data.now)}</p><p class="meta">Orchestrator's note, ${esc(data.updated)}.</p></div>
<div class="sec strip">
<div><h2>Finish line</h2><p class="big">${o.launchTotal - o.launchAccepted}</p><p class="meta">steps to launch · ${o.total - o.launchTotal} more after go-live</p></div>
<a href="#slices"><h2>Slices</h2><p class="big">${o.slicesClosed} of ${o.slices}</p><p class="meta">closed</p></a>
<a href="#activity"><h2>Lanes</h2><p class="big">${data.worktrees.length}</p><p class="meta">build lanes open on the laptop</p></a>
</div>
</section>

<section class="view" id="view-arms" aria-labelledby="h-arms" hidden>
${head("arms", "Arms", 'Five arms make the product. "Own" is the arm\'s pieces built. "To launch" adds the arms it cannot work without: the database counts toward the website and the admin portal, the backend toward both, deployment toward all.')}
<div class="wrap"><table>
<thead><tr><th scope="col">Arm</th><th scope="col">Covers</th><th scope="col">Pieces</th><th scope="col">Own</th><th scope="col">Needs</th><th scope="col">To go</th><th scope="col">To launch</th><th scope="col"><span class="sr">Bar</span></th></tr></thead>
<tbody>
${armRows}
</tbody></table></div>
</section>

<section class="view" id="view-lanes" aria-labelledby="h-lanes" hidden>
${head("lanes", "Lanes", "Phase 0 is the spine: delivery and the database side by side, then the API and tests. Phase 1 runs three lanes at once: public, operations and content. Phase 2 is one lane: hardening, the acceptance panel, then the launch switch.")}
<div class="wrap"><table>
<thead><tr><th scope="col">Lane</th><th scope="col">Slices</th><th scope="col">Accepted</th><th scope="col">In work</th><th scope="col">Percent</th><th scope="col"><span class="sr">Bar</span></th></tr></thead>
<tbody>
${laneRows}
</tbody></table></div>
</section>

<section class="view" id="view-slices" aria-labelledby="h-slices" hidden>
${head("slices", "Slices", "One slice is one plan file, built in step order. Choose a slice to read its steps.")}
<div class="wrap"><table>
<thead><tr><th scope="col">Slice</th><th scope="col">What</th><th scope="col">State</th><th scope="col">Accepted</th><th scope="col">In work</th><th scope="col">Percent</th><th scope="col"><span class="sr">Bar</span></th></tr></thead>
<tbody>
${sliceRows}
</tbody></table></div>
</section>

<section class="view" id="view-steps" aria-labelledby="h-steps" hidden>
${head("steps", "Every step", "Open a slice to read its steps and their state.")}
<div class="tools"><button type="button" data-fold="open">Open all</button><button type="button" data-fold="close">Close all</button>
<ul class="legend" aria-label="Marks">
<li>${mark("accepted")}Accepted</li><li>${mark("work")}In work</li><li>${mark("waiting")}Waiting on you</li><li>${mark("none")}Not started</li>
</ul></div>
${details}
</section>

<section class="view" id="view-activity" aria-labelledby="h-activity" hidden>
${head("activity", "Activity", "What the build agents did, what landed in each lane, and what a step costs.")}
${events || '<p class="meta">No build run in the last two hours.</p>'}
${worktrees}
<h3>Cost per accepted step, by run (newest first)</h3>
<div class="wrap"><table>
<thead><tr><th scope="col">Run</th><th scope="col">Slice</th><th scope="col">Steps</th><th scope="col">Tokens re-read per step</th><th scope="col">Calls per step</th><th scope="col">Agent minutes per step</th><th scope="col">Context per call</th></tr></thead>
<tbody>
${data.costs.map((c) => `<tr><th scope="row">${esc(c.run.slice(3, 11))}</th><td data-label="Slice">${esc(c.slice)}</td><td class="num" data-label="Steps">${c.stepsAccepted}</td><td class="num" data-label="Tokens re-read per step">${(c.total.cacheRead / c.stepsAccepted / 1e6).toFixed(1)}M</td><td class="num" data-label="Calls per step">${Math.round(c.total.calls / c.stepsAccepted)}</td><td class="num" data-label="Agent minutes per step">${Math.round(c.total.min / c.stepsAccepted)}</td><td class="num" data-label="Context per call">${c.total.calls ? Math.round(c.total.cacheRead / c.total.calls / 1000) : 0}k</td></tr>`).join("\n") || '<tr><td colspan="7" class="meta">No finished run with an accepted step in the last two weeks.</td></tr>'}
</tbody></table></div>
<p class="meta">Baseline of 2026-10-02: 121.4M tokens, 499 calls and 119 agent minutes per step, 243k per call.</p>
<h3>Pace</h3>
<p class="callout">${esc(paceLine)}</p>${data.paceNote ? `<p class="meta">Calibration note kept in the ledger: ${esc(data.paceNote)}</p>` : ""}
</section>

<section class="view" id="view-waiting" aria-labelledby="h-waiting" hidden>
${head("waiting", "Waiting on you", "Only you can do these. The orchestrator does everything else, and a step that waits on one of them is marked below.")}
<ol class="check">
${data.waiting.map((w) => `<li><span class="box" aria-hidden="true"></span><div><strong>${esc(w.what)}.</strong><p>${esc(w.why)}</p></div></li>`).join("\n")}
</ol>
${waitingSteps}
</section>

<section class="view" id="view-method" aria-labelledby="h-method" hidden>
${head("method", "How it is counted", "")}
<div class="prose">
<p>A step counts once a second model, in a fresh context, tried to refute it and accepted it. The board reads that from the build's own journal. The orchestrator then re-runs the step's proofs; a step still waiting for that is marked. Built or in review is not done.</p>
<h2>Two figures</h2>
<p>The large figure is the way to launch: every step that has to happen before the site goes live. ${o.total - o.launchTotal} steps can only happen after go-live, such as the first paying property, the week-one watch, the iterate loop, the HSTS preload, the social channels and the audit robot's first Saturday. They are left out of that figure and kept in the overall figure, which counts every planned step.</p>
<h2>Arms</h2>
<p>Every planned piece of the product belongs to one arm. An arm's own percentage weighs its pieces by how far the slice building each one is accepted. Its percentage to launch adds the pieces of the arms it cannot work without.</p>
<h2>States</h2>
<p>A step is accepted, in work, waiting on you, or not started. Waiting on you means the step needs an account or an app only the operator can create. A slice is closed when every one of its steps is accepted.</p>
<h2>The finish line and the sources</h2>
<p>The finish line is every launch step accepted, the hardening and acceptance panel done, and the launch switch run. Steps differ in size, so percentages count steps and pieces, not hours. Sources: the plan files, PLAN.md, trace.json, progress.json and the build journals.${snapshot ? "" : ' Data: <a href="/data.json">data.json</a>.'}</p>
</div>
</section>
</main>
</div>
<script>
${script}
</script>
</body>
</html>`;
}

function summary(data) {
  const o = data.overall;
  return [
    `to launch: ${o.launchAccepted} of ${o.launchTotal} (${o.launchPercent}%); overall: ${o.accepted} of ${o.total} steps accepted (${o.percent}%), ${o.unchecked} of them not yet re-run by the orchestrator, ${o.inReview} in review, ${o.slicesClosed} of ${o.slices} slices closed`,
    ...data.runs.flatMap((run) => run.events.slice(0, 3).map((e) => `${run.title}: ${e.text}: ${e.outcome}`)),
    ...data.lanes.map((l) => `lane ${l.phase} ${l.lane}: ${l.accepted} of ${l.total} (${l.percent}%)`),
    ...data.arms.map((arm) => `arm ${arm.label}: own ${arm.ownPercent}% of ${arm.pieces} pieces; to launch ${arm.percent}% (${arm.remaining} of ${arm.total} pieces to go, counting ${arm.needs.join(", ") || "nothing else"})`),
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
  // --readme <file>: rewrite the progress section of the README between its markers from the same data as the board,
  // so the public page and the board never disagree (operator, 2026-10-04).
  const readmeAt = args.indexOf("--readme");
  if (readmeAt >= 0) {
    const file = args[readmeAt + 1];
    const data = collect();
    const o = data.overall;
    const closed = data.slices.filter((s) => s.state === "closed" && s.total > 0);
    const open = data.slices.filter((s) => s.state === "in progress");
    const row = (s) => `| ${s.id} | ${s.title} | ${s.accepted} of ${s.total} | ${s.percent}% |`;
    const lines = [
      `**Progress (updated ${new Date().toISOString().slice(0, 10)}, from the build board):** ${o.accepted} of ${o.total} planned steps accepted (${o.percent}%), ${o.slicesClosed} of ${o.slices} slices closed, ${o.inReview} steps in work.`,
      "",
      "| Arm | To launch | What it covers |",
      "|---|---|---|",
      ...data.arms.map((a) => `| ${a.label} | ${a.percent}% | ${a.what} |`),
      "",
      "| Slice | What | Accepted | |",
      "|---|---|---|---|",
      ...closed.map(row),
      ...open.map(row),
      "",
      `Not started yet: ${data.slices.filter((s) => s.state === "not started").map((s) => `${s.id} (${s.title})`).join(", ")}.`,
    ];
    const text = readFileSync(file, "utf8");
    const start = text.indexOf("<!-- progress:start -->");
    const end = text.indexOf("<!-- progress:end -->");
    if (start < 0 || end < 0) throw new Error(`${file} has no progress markers`);
    writeFileSync(file, text.slice(0, start) + "<!-- progress:start -->\n" + lines.join("\n") + "\n" + text.slice(end));
    console.log(`board: README progress section written (${o.percent}%)`);
    return;
  }
  const exportAt = args.indexOf("--export");
  if (exportAt >= 0) {
    const data = collect();
    writeFileSync(args[exportAt + 1], render(data, versionOf(data), true));
    console.log(`board: snapshot written to ${args[exportAt + 1]} (${data.overall.percent}%)`);
    return;
  }
  const at = args.indexOf("--port");
  const snapshotAt = args.indexOf("--snapshot");
  // The web server lives in board-server.mjs (rebuilt 2026-10-11): readings in a worker thread, pages from memory.
  void import("./board-server.mjs").then(({ serve }) =>
    serve({ port: at >= 0 ? Number(args[at + 1]) : 8790, snapshot: snapshotAt >= 0 ? args[snapshotAt + 1] : undefined }),
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
