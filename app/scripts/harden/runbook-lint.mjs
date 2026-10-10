// `node scripts/harden/runbook-lint.mjs <docs/runbooks | docs/runbooks/<name>.md | docs/security.md> [--tech-stack <file>]`
// A runbook is a proof, not prose (H1 contract 5). For the folder it lints the four runbooks of OUTLINES, each of which
// must exist; for one of them, that file. A runbook fails when a heading of its outline is missing. Every file and every
// runbook names fails when a path it quotes (inside backticks or a code block) exists neither under app/, nor under the
// repository root, nor as a git-ignored local path, or when it quotes `bun run <name>` and app/package.json has no such
// script; docs/security.md also fails on an H1 row id that scripts/harden/checklist.json lacks. rotation.md also fails
// when its inventory table differs from the secret names of tech-stack section 4, from the names of `.env.example` or
// from the H1-07 name list of checklist.json (G33: one list); `--tech-stack` reads another copy of the tech-stack file.
// Prints `runbooks ok` or `security ok` and exits 0, else prints `file:line: problem` for each problem and exits 1.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

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

// The names tech-stack section 4 and .env.example carry that are not secrets of the inventory (G33), each group with its
// reason. A name here is skipped by the inventory checks; a name in none of these and not in the inventory fails.
/** Identifiers, URLs, flags and public values. */
const NOT_SECRETS = new Set([
  "SUPABASE_URL",
  "SENTRY_DSN",
  "SENTRY_DSN_JOB_RUNNER",
  "MOP_ENV",
  "MEDIA_PUBLIC_BASE",
  "SENTRY_RELEASE",
  "SITE_URL",
  "RENDER_CALLBACK_URL",
  "OMNIKOM_WEBHOOK_URL",
  "RESEND_FROM",
  "RESEND_FROM_BULK",
  "ADMIN_NOTIFY_EMAIL",
  "EMAIL_DRY_RUN",
  "EMAIL_LIVE",
  "SOCIAL_DRY_RUN",
  "SOCIAL_LIVE",
  "CI_HEAVY",
  "GITHUB_REPO",
  "CATALOG_VERSION_TTL_MS",
  "DEV_SUPABASE_POOLER_HOST",
  "DEV_SUPABASE_POOLER_USER",
  "LEGAL_ENTITY_NAME",
  "META_APP_ID",
  "X_CLIENT_ID",
  "LINKEDIN_CLIENT_ID",
  "CF_ZONE_ID",
  "GA4_PROPERTY_ID",
  "SENTRY_ORG",
  "MOP_LAUNCHED",
  "MOP_DB_PRODUCTION",
  "CAPTIONS_CLI",
]);
const NOT_SECRET_PATTERNS = [/_PROJECT_REF$/, /_ACCOUNT_ID$/, /^VITE_/];
/** Stripe arrives after S32. */
const NOT_YET = new Set(["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"]);
/** Section 4 may name these only to say they do not exist (rulings H33 (2), (4) and H35 (1)). */
const RETIRED = new Set([
  "META_DRY_RUN",
  "MEDIA_BASE_URL",
  "DEV_MEDIA_BASE_URL",
  "PROD_MEDIA_BASE_URL",
  "PROD_DB_URL",
]);
const RETIRED_PATTERNS = [/^R2_/];
/** Values that live only in the local .env: agent keys and mock receivers of the rehearsals, not section 4 inventory. */
const LOCAL_ONLY = new Set(["ADMIN_SMOKE_KEY", "OMNIKOM_MOCK_SECRET"]);

/** @param {string} name */
const isConstant = (name) =>
  NOT_SECRETS.has(name) ||
  NOT_YET.has(name) ||
  RETIRED.has(name) ||
  LOCAL_ONLY.has(name) ||
  NOT_SECRET_PATTERNS.some((pattern) => pattern.test(name)) ||
  RETIRED_PATTERNS.some((pattern) => pattern.test(name));

const PATH =
  /(?<![\w./:@-])((?:\.\.?\/)*(?:[\w.@-]+\/)+[\w.@-]+\.(?:mjs|cjs|js|tsx|ts|sh|sql|md|json|ya?ml|toml|pem))(?![\w/])/g;
const BUN_RUN = /\bbun run ([a-z][\w:-]*)(?![\w./:-])/g;
const H1_ID = /\bH1-\d{2}[a-z]?\b/g;
const SECRET_NAME = /^[A-Z][A-Z0-9]*_[A-Z0-9_]+$/;

/** @param {string} file @returns {unknown} */
const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const pkg = /** @type {{ scripts: Record<string, string> }} */ (
  readJson(join(APP, "package.json"))
);
const checklist = /** @type {{ rows: { id: string; command?: string }[] }} */ (
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

/** The backticked names of tech-stack section 4 with their line, wildcards (ending `_*`) apart. @param {string} techStack */
function sectionFourNames(techStack) {
  /** @type {Map<string, number>} */
  const names = new Map();
  /** @type {string[]} */
  const wildcards = [];
  let inside = false;
  readFileSync(techStack, "utf8")
    .split(/\r?\n/)
    .forEach((line, index) => {
      if (/^## 4\./.test(line)) inside = true;
      else if (/^## 5\./.test(line)) inside = false;
      if (!inside) return;
      for (const [, code = ""] of line.matchAll(/`([^`]+)`/g)) {
        if (/^[A-Z][A-Z0-9]*_\*$/.test(code)) wildcards.push(code.slice(0, -1));
        else if (SECRET_NAME.test(code) && !names.has(code)) names.set(code, index + 1);
      }
    });
  return { names, wildcards };
}

/** The names of the .env.example lines, commented or not, with their line. */
function envExampleNames() {
  /** @type {Map<string, number>} */
  const names = new Map();
  readFileSync(join(APP, ".env.example"), "utf8")
    .split(/\r?\n/)
    .forEach((line, index) => {
      const name = /^#?\s*([A-Z][A-Z0-9_]*)=/.exec(line)?.[1];
      if (name !== undefined && !names.has(name)) names.set(name, index + 1);
    });
  return names;
}

/** The names of the grep alternation of row H1-07 that match the name pattern. */
function h107Names() {
  const row = checklist.rows.find((entry) => entry.id === "H1-07");
  const alternation = /grep -rnE "([^"]+)"/.exec(row?.command ?? "")?.[1] ?? "";
  return new Set(alternation.split("|").filter((name) => SECRET_NAME.test(name)));
}

/** The first backticked name of each row of the table under the heading "Cadence and inventory", with its line. @param {string[]} lines */
function inventoryNames(lines) {
  /** @type {Map<string, number>} */
  const names = new Map();
  const start = lines.findIndex((line) =>
    /^#{1,6}\s+(?:\d+[a-z]?\.\s+)?Cadence and inventory\s*$/.test(line),
  );
  if (start < 0) return names;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (/^#{1,6}\s/.test(line)) break;
    const name = /^\|\s*`([^`]+)`/.exec(line)?.[1];
    if (name !== undefined && SECRET_NAME.test(name)) names.set(name, index + 1);
  }
  return names;
}

/** @param {string} where @param {string[]} lines @param {string} techStack @returns {string[]} */
function inventoryProblems(where, lines, techStack) {
  const inventory = inventoryNames(lines);
  if (inventory.size === 0)
    return [`${where}:0: the inventory table of "Cadence and inventory" lists no secret name`];
  const { names: section, wildcards } = sectionFourNames(techStack);
  const problems = [];
  for (const [name, line] of section) {
    if (!inventory.has(name) && !isConstant(name))
      problems.push(
        `${where}:0: ${name} (tech-stack.md:${String(line)}) is in neither the inventory nor a constant`,
      );
  }
  for (const [name, line] of inventory) {
    const listed = section.has(name) || wildcards.some((prefix) => name.startsWith(prefix));
    if (!listed)
      problems.push(`${where}:${String(line)}: ${name} is not a name of tech-stack section 4`);
  }
  for (const [name, line] of envExampleNames()) {
    if (!inventory.has(name) && !isConstant(name))
      problems.push(
        `${where}:0: ${name} (.env.example:${String(line)}) is in neither the inventory nor a constant`,
      );
  }
  const h107 = h107Names();
  for (const [name, line] of inventory) {
    if (!h107.has(name))
      problems.push(`${where}:${String(line)}: ${name} is not in the H1-07 name list`);
  }
  for (const name of h107) {
    if (!inventory.has(name))
      problems.push(`${where}:0: ${name} of the H1-07 name list is not in the inventory`);
  }
  return problems;
}

/** @param {string} file @param {{ security: boolean, techStack: string }} mode @returns {string[]} */
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
  if (basename(file) === "rotation.md")
    problems.push(...inventoryProblems(where, lines, mode.techStack));
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

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: { "tech-stack": { type: "string" } },
  allowPositionals: true,
});
const target = resolve(positionals[0] ?? "");
const techStack = resolve(
  values["tech-stack"] ?? join(ROOT, "workspace/02-tech-stack/tech-stack.md"),
);
const name = basename(target);
const isFolder = existsSync(target) && statSync(target).isDirectory();
if (!isFolder && name !== "security.md" && !(name in OUTLINES)) {
  console.error(
    "usage: node scripts/harden/runbook-lint.mjs <docs/runbooks | a runbook of OUTLINES | docs/security.md> [--tech-stack <file>]",
  );
  process.exit(64);
}
const files = isFolder ? Object.keys(OUTLINES).map((file) => join(target, file)) : [target];
const problems = files.flatMap((file) =>
  lint(file, { security: name === "security.md", techStack }),
);
if (problems.length > 0) {
  for (const problem of problems) console.log(problem);
  process.exit(1);
}
console.log(name === "security.md" ? "security ok" : "runbooks ok");
