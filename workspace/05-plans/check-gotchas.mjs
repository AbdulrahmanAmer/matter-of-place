#!/usr/bin/env node
// Checks the gotcha bank itself, so a stale or malformed entry cannot mislead a builder.
// usage: node workspace/05-plans/check-gotchas.mjs        exit 1 on any ERROR; WARN lines do not fail
// ERROR: a number used twice, an entry without rule, proof or added, a G entry without paths or severity,
//        a severity that is not warn or block.
// WARN:  a path glob that matches no tracked file and that no plan names (it may be a file a later slice creates).
import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const md = readFileSync(join(root, "GOTCHAS.md"), "utf8");
const tracked = execFileSync("git", ["-C", root, "ls-files"], { encoding: "utf8", maxBuffer: 1 << 26 }).split("\n").filter(Boolean);
const plans = readdirSync(here).filter((f) => /^(B|H|L)\S*\.md$/.test(f) || f === "STANDARDS.md").map((f) => readFileSync(join(here, f), "utf8")).join("\n");

function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") { re += ".*"; i++; if (glob[i + 1] === "/") i++; }
      else re += "[^/]*";
    } else if (".+?^${}()|[]\\".includes(c)) re += "\\" + c;
    else re += c;
  }
  return new RegExp("^" + re + "$");
}

const errors = [];
const warns = [];
const seen = new Map();
let g = 0;
let p = 0;
for (const block of md.split(/\n(?=## )/)) {
  const head = (block.match(/^## ((G|P)-(\d+)) · (.+)$/m) || []);
  if (!head[1]) continue; // the template and the preamble
  const id = head[1];
  if (seen.has(id)) errors.push(`${id}: number used twice ("${seen.get(id)}" and "${head[4]}")`);
  seen.set(id, head[4]);
  // a field name may carry a short note in brackets, as in "- rule (S53): ..."
  const field = (name) => (block.match(new RegExp(`^- ${name}(?: \\([^)]*\\))?:\\s*(.+)$`, "m")) || [])[1];
  for (const name of ["rule", "proof", "added"]) if (!field(name)) errors.push(`${id}: no ${name}`);
  if (head[2] === "G") {
    g++;
    const paths = field("paths");
    const severity = field("severity");
    if (!paths) errors.push(`${id}: a G entry needs paths`);
    if (!severity || !["warn", "block"].includes(severity.trim())) errors.push(`${id}: severity must be warn or block`);
    for (const glob of (paths || "").split(",").map((s) => s.trim()).filter(Boolean)) {
      const re = globToRegExp(glob);
      if (tracked.some((f) => re.test(f))) continue;
      const literal = glob.replace(/^app\//, "").replace(/\*\*?\/?/g, "").replace(/\/$/, "");
      if (literal.length > 3 && plans.includes(literal)) continue;
      warns.push(`${id}: path ${glob} matches no tracked file and no plan names it`);
    }
  } else p++;
}
for (const w of warns) console.log("WARN  " + w);
for (const e of errors) console.log("ERROR " + e);
console.log(errors.length ? `check-gotchas: ${errors.length} error(s)` : `check-gotchas: OK (${g} path entries, ${p} process entries${warns.length ? `, ${warns.length} warning(s)` : ""})`);
process.exit(errors.length ? 1 : 0);
