#!/usr/bin/env node
// Resolve a GOTCHAS.md merge conflict in the current checkout, by entry, without judgment.
//
//   node workspace/05-plans/bank-merge.mjs            # during a merge: reads git's three stages of GOTCHAS.md, writes it, stages it
//   node workspace/05-plans/bank-merge.mjs --base <file> --ours <file> --theirs <file> --out <file>   # fixtures, no git
//
// Why a script (P-525, P-072): a text merge of two appends drops hit-again lines; the by-entry driver
// (merge-gotchas.mjs) keeps ours for an entry both sides changed; and the first hand resolver used
// `String.replace` with text that held `$'`, which multiplied the file four times. This one works on parsed
// entries only: for an entry both sides changed it takes main's body and inserts every line the lane added
// (absent from main and from the base) before the entry's "- added:" line. It then proves the result:
// every entry id from either side present exactly once, every body line from either side present, and
// `check-gotchas.mjs` green from this checkout's root. A `- key:` line (not hit-again, not added) that one side
// rewrote while the other still holds the merge base's copy is superseded by the rewrite, not "lost" (2026-10-08,
// PR 230); fixtures name the merge base with --merge-base (default --base).
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { merge, parse } from "./merge-gotchas.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const fixtures = opt("--base") !== undefined;

function stage(n) {
  return execFileSync("git", ["-C", root, "show", `:${String(n)}:GOTCHAS.md`], {
    encoding: "utf8",
    maxBuffer: 1 << 26,
  });
}

const base = fixtures ? readFileSync(opt("--base"), "utf8") : stage(1);
const ours = fixtures ? readFileSync(opt("--ours"), "utf8") : stage(2);
const theirs = fixtures ? readFileSync(opt("--theirs"), "utf8") : stage(3);
const outPath = fixtures ? opt("--out") : join(root, "GOTCHAS.md");

const { text, conflicts } = merge(base, ours, theirs);
const merged = parse(text);
const oursById = new Map(parse(ours).entries.map((e) => [e.id, e.body]));
const theirsById = new Map(parse(theirs).entries.map((e) => [e.id, e.body]));
const baseById = new Map(parse(base).entries.map((e) => [e.id, e.body]));

// The merge base for the supersede rule below: read from git the way the sides are read (`git merge-base HEAD
// MERGE_HEAD`, then `git show <base>:GOTCHAS.md`); fixtures name it with --merge-base, else --base. Unreadable
// means null, and then no line is superseded (the refusal of 2026-10-08 stays what it was).
function readMergeBase() {
  try {
    if (fixtures) return readFileSync(opt("--merge-base") ?? opt("--base"), "utf8");
    const sha = execFileSync("git", ["-C", root, "merge-base", "HEAD", "MERGE_HEAD"], {
      encoding: "utf8",
    }).trim();
    return execFileSync("git", ["-C", root, "show", `${sha}:GOTCHAS.md`], {
      encoding: "utf8",
      maxBuffer: 1 << 26,
    });
  } catch {
    return null;
  }
}
const mergeBase = readMergeBase();
const mergeBaseById =
  mergeBase === null ? new Map() : new Map(parse(mergeBase).entries.map((e) => [e.id, e.body]));

// A `- key: value` line of an entry whose key appears once in that body. Hit-again and added lines repeat or
// carry their own rules, so they are never keyed.
function keyedLines(body) {
  const seen = new Map();
  for (const l of body.split("\n")) {
    const key = /^- ([a-z][a-z-]*(?: [a-z-]+)*):/.exec(l)?.[1];
    if (key === undefined || key.startsWith("hit again") || key === "added") continue;
    seen.set(key, seen.has(key) ? null : l);
  }
  return seen;
}

// A line of an entry on both sides that one side rewrote while the other still holds the merge base's copy was
// changed on purpose: the rewrite supersedes the old copy, nothing is lost (git's own three-way merge agrees).
// Both sides changing the same line differently is not listed here, so it is refused as before.
/** @type {{ id: string, key: string, by: "lane" | "main", old: string, line: string }[]} */
const superseded = [];
for (const [id, mine] of oursById) {
  const main = theirsById.get(id);
  const was = mergeBaseById.get(id);
  if (main === undefined || was === undefined) continue;
  const mineKeyed = keyedLines(mine);
  const mainKeyed = keyedLines(main);
  for (const [key, b] of keyedLines(was)) {
    const l = mineKeyed.get(key);
    const m = mainKeyed.get(key);
    if (b == null || l == null || m == null) continue;
    if (m === b && l !== b) superseded.push({ id, key, by: "lane", old: m, line: l });
    else if (l === b && m !== b) superseded.push({ id, key, by: "main", old: l, line: m });
  }
}

// Two lanes that both took the same number for different entries are not one entry changed on both sides
// (P-1831: B13's series ran past its hundred into B7's). Gluing them loses main's `added` line and the sense
// of both; refuse, and the lane renumbers its entry.
const heading = (body) => (body ?? "").split("\n")[0];
const collisions = conflicts.filter(
  (id) => !baseById.has(id) && heading(oursById.get(id)) !== heading(theirsById.get(id)),
);
if (collisions.length > 0) {
  const lines = collisions.map(
    (id) =>
      `number collision ${id}: main has "${heading(theirsById.get(id))}", the lane has "${heading(oursById.get(id))}"; renumber the lane's entry to the next free number of its series and run again`,
  );
  process.stderr.write(`bank-merge: refused, nothing written\n${lines.join("\n")}\n`);
  process.exit(1);
}

for (const id of conflicts) {
  const mine = oursById.get(id);
  const main = theirsById.get(id);
  if (mine === undefined || main === undefined) throw new Error(`${id} missing on one side`);
  const was = (baseById.get(id) ?? "").split("\n");
  const mainLines = main.split("\n");
  for (const s of superseded) {
    const at = s.id === id && s.by === "lane" ? mainLines.indexOf(s.old) : -1;
    if (at >= 0) mainLines[at] = s.line;
  }
  const extra = mine.split("\n").filter((l) => !mainLines.includes(l) && !was.includes(l));
  const at = mainLines.findIndex((l) => l.startsWith("- added:"));
  mainLines.splice(at < 0 ? mainLines.length : at, 0, ...extra);
  const entry = merged.entries.find((e) => e.id === id);
  if (entry === undefined) throw new Error(`${id} not in the merged text`);
  entry.body = mainLines.join("\n");
  process.stdout.write(`${id}: main's text plus ${String(extra.length)} lane line(s)\n`);
}

// Hit-again lines are append-only records; an earlier merge on either side may have dropped some (P-072), and
// the driver takes one side's body whole. Carry every hit-again line either side holds into the entry, before
// its "- added:" line, in the order they appear on that side.
for (const entry of merged.entries) {
  const lines = entry.body.split("\n");
  const have = new Set(lines);
  const extra = [oursById.get(entry.id), theirsById.get(entry.id)]
    .filter((body) => body !== undefined)
    .flatMap((body) => body.split("\n"))
    .filter((l, i, all) => l.startsWith("- hit again") && !have.has(l) && all.indexOf(l) === i);
  if (extra.length === 0) continue;
  const at = lines.findIndex((l) => l.startsWith("- added:"));
  lines.splice(at < 0 ? lines.length : at, 0, ...extra);
  entry.body = lines.join("\n");
  process.stdout.write(`${entry.id}: ${String(extra.length)} hit-again line(s) carried through\n`);
}

const result = `${[merged.head, ...merged.entries.map((e) => e.body)].join("\n\n")}\n`;

// Proofs before anything is written.
const resultIds = merged.entries.map((e) => e.id);
const dupes = resultIds.filter((id, i) => resultIds.indexOf(id) !== i);
const retired = (byId) =>
  [...byId.keys()].filter((id) => !resultIds.includes(id) && baseById.get(id) === byId.get(id));
const missing = [...new Set([...oursById.keys(), ...theirsById.keys()])].filter(
  (id) =>
    !resultIds.includes(id) && !retired(oursById).includes(id) && !retired(theirsById).includes(id),
);
const resultLines = new Set(result.split("\n"));
const replaced = new Set(superseded.map((s) => `${s.by === "lane" ? "main" : "lane"}\n${s.id}\n${s.old}`));
const lostLines = (byId, label) =>
  [...byId.entries()]
    .filter(([id]) => resultIds.includes(id))
    .flatMap(([id, body]) =>
      body
        .split("\n")
        .filter((l) => l.trim() && !resultLines.has(l) && !replaced.has(`${label}\n${id}\n${l}`))
        .map((l) => `${label} ${id}: ${l.slice(0, 80)}`),
    );
const lost = [...lostLines(oursById, "lane"), ...lostLines(theirsById, "main")];
const problems = [
  ...dupes.map((id) => `duplicate entry ${id}`),
  ...missing.map((id) => `entry lost ${id}`),
  ...lost.map((l) => `line lost: ${l}`),
];
if (problems.length > 0) {
  process.stderr.write(`bank-merge: refused, nothing written\n${problems.join("\n")}\n`);
  process.exit(1);
}

writeFileSync(outPath, result);
for (const s of superseded) {
  process.stdout.write(`superseded 1 line (${s.by} rewrote ${s.id} ${s.key})\n`);
}
if (!fixtures) {
  const check = execFileSync("node", [join(here, "check-gotchas.mjs")], {
    cwd: root,
    encoding: "utf8",
  });
  const last = check.trim().split("\n").pop() ?? "";
  if (!last.startsWith("check-gotchas: OK")) {
    process.stderr.write(`bank-merge: written but ${last}\n`);
    process.exit(1);
  }
  execFileSync("git", ["-C", root, "add", "GOTCHAS.md"]);
  process.stdout.write(`${last}\n`);
}
process.stdout.write(
  `bank-merge: ${String(resultIds.length)} entries, ${String(conflicts.length)} resolved both-sides, 0 lost; ${fixtures ? outPath : "GOTCHAS.md staged"}\n`,
);
