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
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import process from "node:process";

const CODE = /\.(ts|tsx|mjs|js)$/;
const SKIP_DIRS = new Set(["node_modules", ".output", "dist", ".git", ".wrangler", "coverage"]);

const posix = (p) => p.split(sep).join("/");

/** Matter of Place's root (it holds app/tests/mutations) above `file`, or null. */
export function findRoot(file) {
  for (let dir = dirname(resolve(file)); ; dir = dirname(dir)) {
    if (existsSync(join(dir, "app", "tests", "mutations"))) return dir;
    if (dirname(dir) === dir) return null;
  }
}

/** The git top level of `file`, for any other repository, or null. */
function gitRoot(file) {
  const r = spawnSync("git", ["-C", dirname(resolve(file)), "rev-parse", "--show-toplevel"], { encoding: "utf8", windowsHide: true });
  return r.status === 0 && r.stdout.trim() !== "" ? resolve(r.stdout.trim()) : null;
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
  const path = `["'](?:[^"']*/)?${stem.replace(/[.*+?^${}()|[\]\\]/g, (ch) => `\\${ch}`)}(?:\\.(?:ts|tsx|mjs|js))?["']`;
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
/** Titles with placeholders (`it.each(...)("as $label, ...")`, `%s`, `${x}`) as patterns a concrete title can match. */
export function templatedTitles(text) {
  const out = [];
  for (const m of text.matchAll(/\b(?:it|test|describe)(?:\.each\([^)]*\))?\s*\(\s*(["'`])((?:(?!\1).)*?(?:\$\w+|%[sdijo]|\$\{[^}]*\})(?:(?!\1).)*)\1/g)) {
    const parts = m[2].split(/\$\{[^}]*\}|\$\w+|%[sdijo]/).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    out.push(new RegExp(`^${parts.join(".+")}$`));
  }
  return out;
}

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
  const mop = ctx.mop ?? true;
  const app = mop ? join(root, "app") : root;
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
        if (title !== "" && !text.includes(title) && !templatedTitles(text).some((re) => re.test(title))) out.push(`EXPECT ${name}:${e.id} looks for the test "${title}", which is no longer in ${appRel}.`);
      }
    }
    if (!named && registries.length > 0) out.push(`NO ENTRY: no registry entry names ${appRel} as its test; add one (tests/unit/mutation-registry.test.ts fails otherwise).`);
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
    if (mop && !KNIP_EXEMPT.some((re) => re.test(appRel)) && !imports.some(({ i }) => i.whole)) {
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

  // Companion files from today's failures (Matter of Place only).
  if (!mop) return out;
  if (appRel === ".env.example") out.push("COMPANION: every name in .env.example must be in docs/runbooks/rotation.md's inventory or in NOT_SECRETS of scripts/harden/runbook-lint.mjs.");
  if (appRel === "src/server/lib/env.ts") out.push("COMPANION: a Worker variable CI's specs need must also be written by .github/workflows/ci.yml (stack env, dev vars) and set on the Workers; a required one missing there hangs the e2e admin step.");
  if (/^scripts\/.*\.(mjs|ts)$/.test(appRel)) out.push("COMPANION: scripts are type-checked by `bunx tsc --noEmit -p tsconfig.scripts.json` (CI's check job); run it before pushing. `process.env.X` must be `process.env[\"X\"]` there (TS4111).");
  if (/^src\/styles\/admin\/[^/]+\.css$/.test(appRel) && appRel !== "src/styles/admin/index.css") out.push("COMPANION: a sheet under src/styles/admin is imported by src/styles/admin/index.css in alphabetical order (tests/unit/admin-motion.test.ts compares the list).");
  if (appRel === "wrangler.toml") out.push("COMPANION: tests/unit/hygiene.test.ts refuses `key =`, `secret` and `token` in wrangler.toml; a key is a Worker secret.");
  if (appRel === "src/server/jobs/system/health.ts") out.push("COMPANION: tests/unit/jobs/health.test.ts lists every check name in order; add a new check there.");
  if (/^supabase\/migrations\//.test(appRel) && /create table/i.test(text)) out.push("COMPANION: a new table needs tests/db/schema-manifest.ts, tests/db/rls-matrix.ts and a seed row in tests/db/rls.db.test.ts.");
  return out;
}

function gitHead(root, rootRel) {
  const r = spawnSync("git", ["-C", root, "show", `HEAD:${rootRel}`], { encoding: "utf8", windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
  return r.status === 0 ? r.stdout : null;
}

function load(root, mop) {
  const app = mop ? join(root, "app") : root;
  const mutations = join(app, "tests", "mutations");
  const registries = [];
  for (const name of mop ? readdirSync(mutations) : []) {
    if (!name.endsWith(".json")) continue;
    try {
      const entries = JSON.parse(readFileSync(join(mutations, name), "utf8"));
      if (Array.isArray(entries)) registries.push({ name: name.replace(/\.json$/, ""), entries });
    } catch {
      // A registry mid-edit is read on the next edit.
    }
  }
  const sources = [];
  const dirs = mop ? ["src", "tests", "scripts"] : ["src", "test", "tests", "lib", "app", "scripts", "packages"];
  for (const dir of dirs) {
    for (const path of walk(join(app, dir))) {
      if (sources.length >= 6000) break;
      try {
        sources.push({ path, text: readFileSync(path, "utf8") });
      } catch {
        // Unreadable: skipped.
      }
    }
  }
  return { registries, sources };
}

const SEEN_FILE = join(dirname(fileURLToPath(import.meta.url)), ".impact-seen.json");
const fingerprint = (text) => createHash("sha1").update(text).digest("hex");
function readSeen() {
  try {
    return JSON.parse(readFileSync(SEEN_FILE, "utf8"));
  } catch {
    return {};
  }
}
function writeSeen(seen) {
  try {
    writeFileSync(SEEN_FILE, JSON.stringify(seen));
  } catch {
    // A store that cannot be written only means a repeat note next time.
  }
}

/** The folders a command works in: the session folder and each `cd X` in it, resolved in order. */
export function commandDirs(command, cwd) {
  const dirs = [resolve(cwd)];
  let dir = resolve(cwd);
  for (const m of String(command).matchAll(/(?:^|&&|;|\|\||\n)\s*cd\s+("[^"]+"|'[^']+'|[^\s;&|]+)/g)) {
    let target = m[1].replace(/^["']|["']$/g, "");
    const drive = /^\/([a-zA-Z])\/(.*)$/.exec(target);
    if (drive) target = `${drive[1].toUpperCase()}:/${drive[2]}`;
    dir = resolve(dir, target);
    if (!dirs.includes(dir)) dirs.push(dir);
  }
  for (const m of String(command).matchAll(/(?:^|[\s"'=])(\/[a-zA-Z]\/[^\s"';&|]+|[a-zA-Z]:[\\/][^\s"';&|]+)/g)) {
    const drive = /^\/([a-zA-Z])\/(.*)$/.exec(m[1]);
    const path = drive ? `${drive[1].toUpperCase()}:/${drive[2]}` : m[1];
    for (let d = resolve(path); d !== dirname(d); d = dirname(d)) {
      if (existsSync(d) && statSync(d).isDirectory()) {
        if (!dirs.includes(d)) dirs.push(d);
        break;
      }
    }
  }
  return dirs;
}

/** After a Bash command: the changed files of each touched worktree whose content is new since the last look. */
function afterBash(payload) {
  const seen = readSeen();
  const lines = [];
  const tops = new Set();
  for (const dir of commandDirs(payload.tool_input?.command ?? "", payload.cwd ?? process.cwd())) {
    if (!existsSync(dir)) continue;
    const top = spawnSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], { encoding: "utf8", windowsHide: true }).stdout?.trim();
    if (top) tops.add(resolve(top));
  }
  for (const top of tops) {
    const status = spawnSync("git", ["-C", top, "status", "--porcelain", "--untracked-files=all"], { encoding: "utf8", windowsHide: true }).stdout ?? "";
    const fresh = [];
    for (const row of status.split("\n")) {
      const name = row.slice(3).trim().replace(/^"|"$/g, "").split(" -> ").pop();
      if (!name) continue;
      const path = resolve(top, name);
      if (!existsSync(path) || statSync(path).isDirectory()) continue;
      const text = readFileSync(path, "utf8");
      const key = posix(path);
      const print = fingerprint(text);
      if (seen[key] === print) continue;
      seen[key] = print;
      fresh.push({ path, text });
    }
    if (fresh.length === 0) continue;
    const cache = new Map();
    for (const { path, text } of fresh) {
      const mopRoot = findRoot(path);
      const mop = mopRoot !== null && path.startsWith(resolve(mopRoot, "app"));
      const root = mop ? mopRoot : top;
      if (!CODE.test(path) && !mop) continue;
      const cacheKey = `${root}|${String(mop)}`;
      if (!cache.has(cacheKey)) cache.set(cacheKey, load(root, mop));
      const { registries, sources } = cache.get(cacheKey);
      for (const line of findings({ root, mop, file: path, text, headText: gitHead(root, posix(relative(root, path))), sources, registries })) {
        lines.push(`${posix(relative(top, path))}: ${line}`);
      }
    }
  }
  writeSeen(seen);
  if (lines.length === 0) return;
  const context = `edit-impact after the command (fix these before running any test or check):\n- ${lines.join("\n- ")}`;
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: context } }));
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
  if (payload.tool_name === "Bash") return afterBash(payload);
  const file = payload.tool_input?.file_path;
  if (typeof file !== "string" || !existsSync(file)) return;
  const mopRoot = findRoot(file);
  const mop = mopRoot !== null && resolve(file).startsWith(resolve(mopRoot, "app"));
  const root = mop ? mopRoot : gitRoot(file);
  if (root === null || !CODE.test(file) && !mop) return;
  const text = readFileSync(file, "utf8");
  const seen = readSeen();
  seen[posix(resolve(file))] = fingerprint(text);
  writeSeen(seen);
  const { registries, sources } = load(root, mop);
  const lines = findings({ root, mop, file: resolve(file), text, headText: gitHead(root, posix(relative(root, resolve(file)))), sources, registries });
  if (lines.length === 0) return;
  const context = `edit-impact (fix these before running any test or check):\n- ${lines.join("\n- ")}`;
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: context } }));
}

/** `--changed <dir>`: the files changed in that worktree since HEAD, tracked or new, each checked as after an edit. */
function changedMain(dir) {
  const git = (...args) => spawnSync("git", ["-C", dir, ...args], { encoding: "utf8", windowsHide: true }).stdout ?? "";
  const top = git("rev-parse", "--show-toplevel").trim();
  if (top === "") return 2;
  const names = [...git("diff", "--name-only", "HEAD").split("\n"), ...git("ls-files", "--others", "--exclude-standard").split("\n")]
    .map((n) => n.trim())
    .filter((n) => n !== "");
  let found = 0;
  for (const name of [...new Set(names)]) {
    const file = resolve(top, name);
    if (!existsSync(file)) continue;
    const mopRoot = findRoot(file);
    const mop = mopRoot !== null && file.startsWith(resolve(mopRoot, "app"));
    const root = mop ? mopRoot : top;
    if (!CODE.test(file) && !mop) continue;
    const { registries, sources } = load(root, mop);
    const lines = findings({ root, mop, file, text: readFileSync(file, "utf8"), headText: gitHead(root, posix(relative(root, file))), sources, registries });
    for (const line of lines) console.log(`${name}: ${line}`);
    found += lines.length;
  }
  console.log(found === 0 ? "edit-impact: nothing to fix" : `edit-impact: ${String(found)} to fix before running anything`);
  return found === 0 ? 0 : 1;
}

if (process.argv[1] && /edit-impact\.mjs$/.test(process.argv[1])) {
  const at = process.argv.indexOf("--changed");
  if (at > 0) process.exit(changedMain(process.argv[at + 1] ?? process.cwd()));
  await main();
}
