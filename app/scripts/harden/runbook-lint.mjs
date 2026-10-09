// `node scripts/harden/runbook-lint.mjs <docs/runbooks | docs/runbooks/<name>.md | docs/security.md>`
// A runbook is a proof, not prose (H1 contract 5). For the folder it lints the four runbooks of OUTLINES, each of which
// must exist; for one of them, that file. A runbook fails when a heading of its outline is missing. Every file and every
// runbook names fails when a path it quotes (inside backticks or a code block) exists neither under app/, nor under the
// repository root, nor as a git-ignored local path, or when it quotes `bun run <name>` and app/package.json has no such
// script; docs/security.md also fails on an H1 row id that scripts/harden/checklist.json lacks. Prints `runbooks ok` or
// `security ok` and exits 0, else prints `file:line: problem` for each problem and exits 1.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP = fileURLToPath(new URL("../../", import.meta.url));
const ROOT = resolve(APP, "..");

/** The required headings of each runbook, copied from the outlines of plan H1 (Files). */
const OUTLINES = {
  "incident.md": [
    "Read this first",
    "Who is paged",
    "The first five checks",
    "Roll back the Worker",
    "Put the whole site in coming-soon",
    "Disable a channel",
    "Revoke an agent key",
    "Take a page down",
    "What to say",
    "Afterwards",
  ],
  "rotation.md": [
    "Rules",
    "Cadence and inventory",
    "Procedure per secret",
    "Agent keys",
    "If a secret leaks",
    "Record and check",
  ],
  "rollback.md": [
    "When to roll back",
    "Roll back the Worker",
    "What a rollback does not undo",
    "Roll back the job runner",
    "The in-job rollback",
    "Migrations: expand then contract",
    "Irreversible migrations",
    "Drill record",
  ],
  "restore.md": [
    "Where the dumps are",
    "Decrypt",
    "Restore into a throwaway cluster",
    "Restore into a Supabase project (existing or new)",
    "What is not in the dump",
    "Drill record",
  ],
};

const PATH =
  /(?<![\w./:@-])((?:\.\.?\/)*(?:[\w.@-]+\/)+[\w.@-]+\.(?:mjs|cjs|js|tsx|ts|sh|sql|md|json|ya?ml|toml|pem))(?![\w/])/g;
const BUN_RUN = /\bbun run ([a-z][\w:-]*)(?![\w./:-])/g;
const H1_ID = /\bH1-\d{2}[a-z]?\b/g;

/** @param {string} file @returns {unknown} */
const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const pkg = /** @type {{ scripts: Record<string, string> }} */ (
  readJson(join(APP, "package.json"))
);
const checklist = /** @type {{ rows: { id: string }[] }} */ (
  readJson(join(APP, "scripts/harden/checklist.json"))
);
const rowIds = new Set(checklist.rows.map((row) => row.id));

/** @param {string} path */
function ignored(path) {
  return spawnSync("git", ["check-ignore", "-q", "--no-index", path], { cwd: ROOT }).status === 0;
}

/** @param {string} path */
function exists(path) {
  return existsSync(resolve(APP, path)) || existsSync(resolve(ROOT, path)) || ignored(path);
}

/** The quoted text of each line: inline code spans, and whole lines inside a fenced block. @param {string[]} lines */
function quoted(lines) {
  let fenced = false;
  return lines.map((line) => {
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      return "";
    }
    if (fenced) return line;
    return [...line.matchAll(/`([^`]+)`/g)].map((m) => m[1] ?? "").join("\n");
  });
}

/** @param {string} file @param {{ security: boolean }} mode @returns {string[]} */
function lint(file, mode) {
  const where = relative(APP, file).replaceAll("\\", "/");
  if (!existsSync(file)) return [`${where}:0: missing`];
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  const problems = [];
  const outline = /** @type {Record<string, string[]>} */ (OUTLINES)[basename(file)] ?? [];
  const headings = new Set(
    lines.flatMap((line) => {
      const title = /^#{1,6}\s+(?:\d+[a-z]?\.\s+)?(.+?)\s*$/.exec(line)?.[1];
      return title === undefined ? [] : [title];
    }),
  );
  for (const heading of outline) {
    if (!headings.has(heading)) problems.push(`${where}:0: no heading "${heading}"`);
  }
  quoted(lines).forEach((code, index) => {
    const at = `${where}:${String(index + 1)}`;
    for (const [, path = ""] of code.matchAll(PATH)) {
      if (!path.includes("YYYY") && !exists(path)) problems.push(`${at}: ${path} does not exist`);
    }
    for (const [, name = ""] of code.matchAll(BUN_RUN)) {
      if (pkg.scripts[name] === undefined)
        problems.push(`${at}: bun run ${name} is not a script of package.json`);
    }
  });
  if (mode.security) {
    lines.forEach((line, index) => {
      for (const [id] of line.matchAll(H1_ID)) {
        if (!rowIds.has(id))
          problems.push(`${where}:${String(index + 1)}: ${id} is not a row of checklist.json`);
      }
    });
  }
  return problems;
}

const target = resolve(process.argv[2] ?? "");
const name = basename(target);
const isFolder = existsSync(target) && statSync(target).isDirectory();
if (!isFolder && name !== "security.md" && !(name in OUTLINES)) {
  console.error(
    "usage: node scripts/harden/runbook-lint.mjs <docs/runbooks | a runbook of OUTLINES | docs/security.md>",
  );
  process.exit(64);
}
const files = isFolder ? Object.keys(OUTLINES).map((file) => join(target, file)) : [target];
const problems = files.flatMap((file) => lint(file, { security: name === "security.md" }));
if (problems.length > 0) {
  for (const problem of problems) console.log(problem);
  process.exit(1);
}
console.log(name === "security.md" ? "security ok" : "runbooks ok");
