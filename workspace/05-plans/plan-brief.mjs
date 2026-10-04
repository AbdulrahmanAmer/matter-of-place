#!/usr/bin/env node
// The brief a builder or reviewer works from instead of the whole plan (ruling H52 (1), premade sizing H53):
//   node workspace/05-plans/plan-brief.mjs <slice> --steps "8,9" [--files "a/b.ts,c/d.sql"]
// Prints, verbatim from the plan: the named steps; every line of the Contract and Data sections that names one of
// the files, one of the step numbers or a word the steps introduce; the Files-list lines of the files. Mechanical,
// so the same group gets the same brief on every run.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const [slice, ...rest] = process.argv.slice(2);
if (!slice) {
  console.error('usage: node workspace/05-plans/plan-brief.mjs <slice> --steps "8,9" [--files "path,path"]');
  process.exit(2);
}
const opt = (name) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : ""; };
const steps = opt("--steps").split(/[,\s]+/).filter(Boolean);
const files = opt("--files").split(/[,\s]+/).filter(Boolean);
const text = readFileSync(join(dirname(fileURLToPath(import.meta.url)), `${slice}.md`), "utf8");
const lines = text.split("\n");

const section = (title) => {
  const start = lines.findIndex((l) => l.startsWith(`## ${title}`));
  if (start < 0) return [];
  const end = lines.findIndex((l, i) => i > start && l.startsWith("## "));
  return lines.slice(start + 1, end < 0 ? lines.length : end);
};
const stepLines = section("Steps");
const out = [`# Brief for ${slice}, steps ${steps.join(", ")} (quoted from ${slice}.md; open the plan only for a section named here and not quoted)`, ""];
out.push("## The steps, verbatim");
const stepIds = new Set(steps);
let keep = false;
for (const l of stepLines) {
  const m = l.match(/^(\d+[a-z]?)\. /);
  if (m) keep = stepIds.has(m[1]);
  if (keep && l.trim()) out.push(l);
}
// words the steps introduce: backticked names in the step text (files, functions, tables), used to pick contract lines
const stepText = out.slice(3).join("\n");
// only names that look like files, functions or scripts (a slash, a dot or parentheses); a bare table or column
// word such as `settings` would pull in most of the plan
const names = new Set([...stepText.matchAll(/`([^`\n]{3,60})`/g)].map((m) => m[1]).filter((n) => /[/().]/.test(n) && !/^\.{1,2}$/.test(n)));
for (const f of files) { names.add(f); names.add(f.split("/").pop()); }
const mentions = (l) => [...names].some((n) => l.includes(n)) || [...stepIds].some((s) => new RegExp(`\\bstep ${s}\\b`).test(l));
for (const title of ["Contract", "Data changes", "Verification", "Risks and gotchas"]) {
  const picked = section(title).filter((l) => l.trim() && mentions(l));
  if (picked.length) out.push("", `## From "${title}", the lines that name this group's work`, ...picked);
}
// the Files lines of the group's own paths and of every path the step text names: a step that says "write
// `scripts/cache-proof.mjs` (Files)" is scope even when the sizing's file list omits it (P-513)
const fileLines = section("Files").filter((l) => l.trim() && (files.some((f) => l.includes(f) || l.includes(f.split("/").pop())) || mentions(l)));
if (fileLines.length) out.push("", "## From the Files list", ...fileLines);
const goal = section("Goal and observed exit").filter((l) => l.trim()).slice(0, 6);
if (goal.length) out.push("", "## The slice's goal, first lines", ...goal);
console.log(out.join("\n"));
console.error(`plan-brief: ${out.join("\n").length} characters (the plan is ${text.length})`);
