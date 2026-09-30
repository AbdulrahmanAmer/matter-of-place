// Renders every ```mermaid block in the .md files of this folder to PNG + SVG under ./img.
// Usage (from anywhere):  node "E:/Matter Of Place/workspace/03-diagrams/render.mjs"
// Output: img/<md basename>-<n>.png and .svg, one per diagram, in document order.
// Uses @mermaid-js/mermaid-cli 12 through bunx (npm's npx hit a cache lock on this machine, 2026-09-30).
// First run installs puppeteer's Chromium (~2 min); later runs take seconds. Zero tokens.
import { readdirSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "img");
mkdirSync(out, { recursive: true });

const bunx = process.platform === "win32" ? "bunx.exe" : "bunx";
let failed = 0;

// Lint (GOTCHAS P-012): catch the Mermaid mistakes that broke renders before the slow render runs.
function lint(file, md) {
  const problems = [];
  const blocks = [...md.matchAll(/```mermaid\n([\s\S]*?)```/g)];
  blocks.forEach((m, bi) => {
    const lines = m[1].split("\n");
    const kind = (lines[0] || "").trim();
    lines.forEach((l, i) => {
      const where = `${file} block ${bi + 1} line ${i + 1}`;
      if (kind.startsWith("sequenceDiagram") && /^(\s*\w+\s*-[->x)]+\s*\w+\s*:|\s*Note\b)/.test(l) && l.includes(";")) problems.push(`${where}: ';' inside a sequence message or Note ends the statement; use a comma`);
      if (kind.startsWith("flowchart") || kind.startsWith("graph")) {
        if (/\[\/(?!")/.test(l) && !/\["/.test(l)) problems.push(`${where}: label starting with '/' opens a trapezoid; quote it: id["/path"]`);
        if (/^\s*subgraph\b.*:::/.test(l)) problems.push(`${where}: ':::class' is not allowed on a subgraph; use 'style <id> ...'`);
        if (/^\s*subgraph\s+\w+\s*\[\//.test(l)) problems.push(`${where}: quote a subgraph label that starts with '/' → subgraph ID["/label"]`);
      }
    });
  });
  return problems;
}

const only = process.argv[2] ? basename(process.argv[2]) : null; // optional: render one file (GOTCHAS P-020)
for (const file of readdirSync(here).filter((f) => f.endsWith(".md") && (!only || f === only))) {
  const md = readFileSync(join(here, file), "utf8");
  const blocks = (md.match(/```mermaid\n/g) || []).length;
  if (!blocks) continue;
  const problems = lint(file, md);
  if (problems.length) { failed++; console.error(`LINT FAILED ${file}\n  ${problems.join("\n  ")}`); continue; }
  const base = basename(file, ".md");
  for (const [ext, extra] of [["png", ["--size", "2400", "--scale", "2"]], ["svg", []]]) {
    const args = ["@mermaid-js/mermaid-cli", "-i", join(here, file), "-o", join(out, `${base}.${ext}`), "-b", "white", "-q", ...extra];
    const r = spawnSync(bunx, args, { encoding: "utf8", cwd: here });
    const ok = r.status === 0 && existsSync(join(out, `${base}-1.${ext}`));
    if (!ok) { failed++; console.error(`FAILED ${base}.${ext}\n${(r.stderr || r.stdout || "").slice(-800)}`); }
    else console.log(`${base}: ${blocks} diagram(s) → ${ext}`);
  }
}
console.log(failed ? `done with ${failed} failure(s)` : `done → ${out}`);
process.exit(failed ? 1 : 0);
