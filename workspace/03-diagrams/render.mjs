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
for (const file of readdirSync(here).filter((f) => f.endsWith(".md"))) {
  const blocks = (readFileSync(join(here, file), "utf8").match(/```mermaid\n/g) || []).length;
  if (!blocks) continue;
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
