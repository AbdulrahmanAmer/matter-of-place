// PostToolUse hook on Edit|Write|MultiEdit: right after a file changes, says what the change broke elsewhere, before any
// test runs (operator, 2026-10-13: "make sure that you optimize the tests before you run them, then have to wait for them
// then having to adjust them again ... embedded directly in the harness"). Every finding comes from the files as they
// are now and from git's last commit, never from memory:
//  - a watched-fail entry of this file whose `find` no longer occurs exactly once (the replay would print STALE);
//  - for a test file: an entry whose `expect` names a test title that is gone, and a test file no entry names
//    (tests/unit/mutation-registry.test.ts fails);
//  - an export that existed at HEAD and is gone, with the files that still import it;
//  - an export nothing else references (knip fails);
//  - the tests that import this file, to re-read before running them;
//  - the companion files today's failures came from (.env.example, wrangler.toml, health checks, a new table).
// Silent when it finds nothing. Test: node .claude/hooks/edit-impact.test.mjs
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import process from "node:process";

const CODE = /\.(ts|tsx|mjs|js)$/;
const SKIP_DIRS = new Set(["node_modules", ".output", "dist", ".git", ".wrangler", "coverage"]);

const posix = (p) => p.split(sep).join("/");

/** The repository root that holds app/tests/mutations above `file`, or null. */
export function findRoot(file) {
  for (let dir = dirname(resolve(file)); ; dir = dirname(dir)) {
    if (existsSync(join(dir, "app", "tests", "mutations"))) return dir;
    if (dirname(dir) === dir) return null;
  }
}

function walk(dir, out = []) {
  let names = [];
  try {
    names = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of names) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(full, out);
    else if (CODE.test(name)) out.push(full);
  }
  return out;
}

const occurrences = (text, needle) => (needle === "" ? 0 : text.split(needle).length - 1);

/** Names a module exports (declarations and `export { a, b as c }`). */
export function exportedNames(text) {
  const names = new Set();
  for (const m of text.matchAll(/^export\s+(?:default\s+)?(?:async\s+)?(?:function\*?|const|let|var|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/gm)) {
    names.add(m[1]);
  }
  for (const m of text.matchAll(/^export\s+(?:type\s+)?\{([^}]*)\}/gm)) {
    for (const part of m[1].split(",")) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (name) names.add(name);
    }
  }
  return names;
}

/**
 * What `text` imports from a module whose file stem is `stem`: the named imports, and whether it takes the whole module
 * (`* as x`, `export * from`). Only import and export-from statements count, never a word in a string.
 */
export function importsFrom(text, stem) {
  const names = new Set();
  let whole = false;
  const path = `["'](?:[^"']*/)?${stem.replace(/[.*+?^${}()|[\]\\]/g, "\\/** The literal test title an `expect` regex looks for")}(?:\\.(?:ts|tsx|mjs|js))?["']`;
  const re = new RegExp(`(?:import|export)\\s+(type\\s+)?([^;]*?)\\s+from\\s+${path}`, "g");
  for (const m of text.matchAll(re)) {
    const clause = m[2] ?? "";
    if (/\*/.test(clause)) whole = true;
    const braces = /\{([^}]*)\}/.exec(clause)?.[1];
    if (braces !== undefined) {
      for (const part of braces.split(",")) {
        const name = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]?.trim();
        if (name) names.add(name);
      }
    }
  }
  return { names, whole, any: whole || names.size > 0 };
}

/** knip.json's entry and ignore patterns: an entry's exports are never reported unused. */
const KNIP_EXEMPT = [
  /^src\/routes\//,
  /^scripts\//,
  /^supabase\/functions\/[^/]+\/index\.ts$/,
  /^tests\//,
  /^src\/domain\/index\.ts$/,
  /^src\/db\/index\.ts$/,
  /^src\/server\/nitro\/[^/]+\.ts$/,
  /^src\/db\/types\.ts$/,
  /^src\/domain\/enums\.check\.ts$/,
  /^src\/templates\/email\/(?!layout|blocks)[^/]+\.tsx$/,
  /\.test\.(ts|tsx)$/,
];

/** The literal test title an `expect` regex looks for (the text after `× .*`, up to the first regex token). */
export function expectedTitle(expect) {
  const after = /×\s*\.\*\s*(.*)$/.exec(expect)?.[1] ?? "";
  const literal = after.split(/(?<!\\)[|()[\]{}*+?^$]/)[0] ?? "";
  return literal.replace(/\\(.)/g, "$1").trim();
}

/**
 * The findings for one edited file, as lines.
 * @param {{ root: string, file: string, text: string, headText: string | null, sources: { path: string, text: string }[], registries: { name: string, entries: any[] }[] }} ctx
 */
export function findings(ctx) {
  const { root, file, text, headText, sources, registries } = ctx;
  const app = join(root, "app");
  const appRel = posix(relative(app, file));
  const rootRel = posix(relative(root, file));
  const out = [];

  // Watched-fail entries of this file.
  for (const { name, entries } of registries) {
    for (const e of entries) {
      if (typeof e.file !== "string" || typeof e.find !== "string") continue;
      if (posix(resolve(app, e.file)) !== posix(resolve(file))) continue;
      const n = occurrences(text, e.find);
      if (n !== 1) out.push(`STALE ${name}:${e.id}: its find occurs ${String(n)} times in ${appRel}; update the entry or the code before any replay.`);
    }
  }

  // A test file: titles the registry expects, and a registry entry naming the file.
  if (/\.test\.(ts|tsx|mjs)$/.test(file) && appRel.startsWith("tests/") || /\.test\.(ts|tsx)$/.test(file) && appRel.startsWith("src/")) {
    let named = false;
    for (const { name, entries } of registries) {
      for (const e of entries) {
        if (e.test !== appRel) continue;
        named = true;
        const title = typeof e.expect === "string" ? expectedTitle(e.expect) : "";
        if (title !== "" && !text.includes(title)) out.push(`EXPECT ${name}:${e.id} looks for the test "${title}", which is no longer in ${appRel}.`);
      }
    }
    if (!named) out.push(`NO ENTRY: no registry entry names ${appRel} as its test; add one (tests/unit/mutation-registry.test.ts fails otherwise).`);
  }

  // Exports gone since HEAD, and exports nothing else uses.
  if (CODE.test(file)) {
    const now = exportedNames(text);
    const before = headText === null ? new Set() : exportedNames(headText);
    const stem = basename(file).replace(CODE, "");
    const others = sources.filter((s) => posix(resolve(s.path)) !== posix(resolve(file)));
    const imports = others.map((s) => ({ s, i: importsFrom(s.text, stem) })).filter(({ i }) => i.any);
    for (const gone of [...before].filter((n) => !now.has(n))) {
      const users = imports.filter(({ i }) => i.names.has(gone)).map(({ s }) => posix(relative(root, s.path)));
      if (users.length > 0) out.push(`GONE ${gone} left ${rootRel} but is still imported by: ${users.slice(0, 8).join(", ")}.`);
    }
    if (!KNIP_EXEMPT.some((re) => re.test(appRel)) && !imports.some(({ i }) => i.whole)) {
      for (const name of now) {
        if (name === "default") continue;
        const used = imports.some(({ i }) => i.names.has(name));
        if (!used) out.push(`UNUSED export ${name} in ${rootRel}: nothing else references it, so knip fails; drop the export or use it.`);
      }
    }
    const importers = imports
      .filter(({ s }) => /\.test\.(ts|tsx|mjs)$/.test(s.path))
      .map(({ s }) => posix(relative(root, s.path)));
    if (importers.length > 0 && out.length > 0) out.push(`TESTS that import ${basename(file)}: ${importers.slice(0, 10).join(", ")}; re-read them for moved names before running.`);
  }

  // Companion files from today's failures.
  if (appRel === ".env.example") out.push("COMPANION: every name in .env.example must be in docs/runbooks/rotation.md's inventory or in NOT_SECRETS of scripts/harden/runbook-lint.mjs.");
  if (appRel === "wrangler.toml") out.push("COMPANION: tests/unit/hygiene.test.ts refuses `key =`, `secret` and `token` in wrangler.toml; a key is a Worker secret.");
  if (appRel === "src/server/jobs/system/health.ts") out.push("COMPANION: tests/unit/jobs/health.test.ts lists every check name in order; add a new check there.");
  if (/^supabase\/migrations\//.test(appRel) && /create table/i.test(text)) out.push("COMPANION: a new table needs tests/db/schema-manifest.ts, tests/db/rls-matrix.ts and a seed row in tests/db/rls.db.test.ts.");
  return out;
}

function gitHead(root, rootRel) {
  const r = spawnSync("git", ["-C", root, "show", `HEAD:${rootRel}`], { encoding: "utf8", windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
  return r.status === 0 ? r.stdout : null;
}

function load(root) {
  const app = join(root, "app");
  const mutations = join(app, "tests", "mutations");
  const registries = [];
  for (const name of readdirSync(mutations)) {
    if (!name.endsWith(".json")) continue;
    try {
      const entries = JSON.parse(readFileSync(join(mutations, name), "utf8"));
      if (Array.isArray(entries)) registries.push({ name: name.replace(/\.json$/, ""), entries });
    } catch {
      // A registry mid-edit is read on the next edit.
    }
  }
  const sources = [];
  for (const dir of ["src", "tests", "scripts"]) {
    for (const path of walk(join(app, dir))) {
      try {
        sources.push({ path, text: readFileSync(path, "utf8") });
      } catch {
        // Unreadable: skipped.
      }
    }
  }
  return { registries, sources };
}

async function main() {
  let raw = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) raw += chunk;
  let payload = {};
  try {
    payload = JSON.parse(raw || "{}");
  } catch {
    return;
  }
  const file = payload.tool_input?.file_path;
  if (typeof file !== "string" || !existsSync(file)) return;
  const root = findRoot(file);
  if (root === null || !resolve(file).startsWith(resolve(root, "app"))) return;
  const text = readFileSync(file, "utf8");
  const { registries, sources } = load(root);
  const lines = findings({ root, file: resolve(file), text, headText: gitHead(root, posix(relative(root, resolve(file)))), sources, registries });
  if (lines.length === 0) return;
  const context = `edit-impact (fix these before running any test or check):\n- ${lines.join("\n- ")}`;
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: context } }));
}

if (process.argv[1] && /edit-impact\.mjs$/.test(process.argv[1])) await main();
