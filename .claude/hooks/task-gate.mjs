// A step list where every step carries the check that proves it, and a Stop hook that will not let a session end while
// a step it can do is unproven (operator, 2026-10-15: "a really super strict tool ... a task list that you will follow
// through as your steps ... with a criteria check if you got that step done or not"). The same evaluation is Matter's
// goal: his live supervisor (scripts/matter/live.ts) reads it between turns and hands him the next open step.
//
// A list is JSON: {"goal": "...", "steps": [{"id", "title", "check": <check>, "person": true?}]}. A check is one of
//   {"cmd": "shell command"}                  passes when it exits 0 (run with bash, 120 s at most)
//   {"plan": "workspace/05-plans/W7.md"}      passes when origin/main's copy has no open "- [ ]" box that is not PERSON
//   {"box": {"plan": "...", "item": "3"}}     passes when origin/main's copy has "- [x] 3." ticked
// A "person" step is the operator's (a password, a card, a click only he may make): it is shown, never blocks.
//
// usage: node task-gate.mjs status <list.json>   every step with PASS / FAIL / PERSON; exit 1 while one of ours fails
//        node task-gate.mjs next <list.json>     the first open step only
//        node task-gate.mjs --stop <list.json>   Stop hook: blocks the stop with the open step; a missing list is no goal
//        node task-gate.mjs wait <list.json> "<what reports back>" [minutes]   a declared wait (30 min at most) on a
//          background job or CI that will wake the session: the stop is allowed until it expires, then blocked again
// Test: node .claude/hooks/task-gate.test.mjs
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

/** The repository root that holds a list's plan files: the list's own repo, else the working directory's. */
function repoRoot(start) {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, ".git"))) return dir;
    const up = dirname(dir);
    if (up === dir) return resolve(start);
    dir = up;
  }
}

/** origin/main's copy of a file, fetched at most once a minute; no shell, so no path rewriting (P-3465). */
function mainCopy(root, path) {
  const stamp = join(root, ".git-task-gate-fetch");
  let fresh = false;
  try {
    fresh = Date.now() - statSync(stamp).mtimeMs < 60_000;
  } catch {
    fresh = false;
  }
  if (!fresh) {
    spawnSync("git", ["-C", root, "fetch", "-q", "origin", "main"], { timeout: 30_000 });
    try {
      writeFileSync(stamp, new Date().toISOString());
    } catch {
      // a read-only checkout still answers from what it has
    }
  }
  return execFileSync("git", ["-C", root, "show", `origin/main:${path}`], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
}

/** The open boxes of a plan that are ours: "- [ ]" lines not marked PERSON. */
export function openItems(text) {
  return text
    .split("\n")
    .filter((line) => /^- \[ \] /.test(line) && !/PERSON/.test(line))
    .map((line) => line.replace(/^- \[ \] /, "").replace(/\*\*/g, "").slice(0, 160));
}

/** One step's verdict: {pass, detail}. Never throws: a check that cannot run is a failure that says why. */
export function evaluate(step, root, run = defaultRun) {
  const check = step.check ?? {};
  try {
    if (typeof check.cmd === "string") {
      const result = run(check.cmd, root);
      return {
        pass: result.status === 0,
        detail: result.status === 0 ? "" : `exit ${String(result.status)}: ${result.tail}`,
      };
    }
    if (typeof check.plan === "string") {
      const open = openItems(mainCopy(root, check.plan));
      return {
        pass: open.length === 0,
        detail: open.length === 0 ? "" : `${String(open.length)} open in ${check.plan}; next: ${open[0]}`,
      };
    }
    if (check.box && typeof check.box.plan === "string") {
      const text = mainCopy(root, check.box.plan);
      const ticked = new RegExp(`^- \\[x\\] ${String(check.box.item).replace(/\./g, "\\.")}\\. `, "m").test(text);
      return { pass: ticked, detail: ticked ? "" : `item ${String(check.box.item)} of ${check.box.plan} is not ticked on main` };
    }
    return { pass: false, detail: "the step has no check it can run" };
  } catch (error) {
    return { pass: false, detail: `the check could not run: ${String(error?.message ?? error).slice(0, 200)}` };
  }
}

function defaultRun(cmd, root) {
  const result = spawnSync("bash", ["-c", cmd], { cwd: root, encoding: "utf8", timeout: 120_000 });
  const out = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim().split("\n").slice(-2).join(" | ");
  return { status: result.status ?? 1, tail: out.slice(0, 300) };
}

/** Every step's verdict, and the first open step that is ours. */
export function review(list, root, run = defaultRun) {
  const results = (list.steps ?? []).map((step) => ({
    step,
    ...(step.person === true ? { pass: false, detail: "the operator's" } : evaluate(step, root, run)),
  }));
  const open = results.find((r) => !r.pass && r.step.person !== true) ?? null;
  return { results, open };
}

export function stopVerdict(list, root, run = defaultRun) {
  const { open } = review(list, root, run);
  if (open === null) return null;
  return {
    decision: "block",
    reason: `Goal not met: "${list.goal ?? "the step list"}". Open step ${open.step.id}: ${open.step.title}. ${open.detail} Do it now, then its check decides.`,
  };
}

function readList(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

const WAIT_MAX_MINUTES = 30;

/** A declared wait on work that will report back (a background job, CI): the stop is allowed until it expires. */
export function waitActive(text, now = Date.now()) {
  try {
    const wait = JSON.parse(text);
    return typeof wait.until === "string" && Date.parse(wait.until) > now && typeof wait.on === "string" && wait.on !== "";
  } catch {
    return false;
  }
}

function waitFile(list) {
  return `${list}.wait`;
}

async function main() {
  const [mode, file] = process.argv.slice(2);
  if (mode === "--stop") {
    for await (const chunk of process.stdin) void chunk;
    if (file === undefined || !existsSync(file)) return;
    if (existsSync(waitFile(file)) && waitActive(readFileSync(waitFile(file), "utf8"))) return;
    const verdict = stopVerdict(readList(file), repoRoot(dirname(resolve(file))));
    if (verdict !== null) process.stdout.write(JSON.stringify(verdict));
    return;
  }
  if (mode === "wait" && file !== undefined) {
    const [, , on = "", minutes = "15"] = process.argv.slice(2);
    const span = Math.min(Math.max(Number(minutes) || 15, 1), WAIT_MAX_MINUTES);
    if (on.trim() === "") {
      console.error('usage: node task-gate.mjs wait <list.json> "<what reports back>" [minutes, at most 30]');
      process.exitCode = 2;
      return;
    }
    const until = new Date(Date.now() + span * 60_000).toISOString();
    writeFileSync(waitFile(file), JSON.stringify({ on, until }));
    console.log(`waiting on ${on} until ${until}`);
    return;
  }
  if ((mode === "status" || mode === "next") && file !== undefined) {
    const list = readList(file);
    const { results, open } = review(list, repoRoot(process.cwd()));
    if (mode === "next") {
      console.log(open === null ? "DONE" : `${open.step.id} ${open.step.title}${open.detail ? ` (${open.detail})` : ""}`);
    } else {
      for (const r of results) {
        const mark = r.step.person === true ? "PERSON" : r.pass ? "PASS  " : "FAIL  ";
        console.log(`${mark} ${r.step.id} ${r.step.title}${r.pass || r.step.person ? "" : `\n         ${r.detail}`}`);
      }
    }
    process.exitCode = open === null ? 0 : 1;
    return;
  }
  console.error("usage: node task-gate.mjs status|next|--stop <list.json>");
  process.exitCode = 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
