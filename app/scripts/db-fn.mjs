// `bun run db:fn [--name <migration name>] <name> [<name>...]`: a function changes only by editing
// supabase/sql/functions/<name>.sql and running this, which writes a new migration holding that text (DB-13, STANDARDS
// R19), so two lanes that edit one function meet as a git conflict on one file.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { migrationFiles } from "./lib/push-guard.mjs";

const APP = fileURLToPath(new URL("..", import.meta.url));
const MIGRATIONS = fileURLToPath(new URL("../supabase/migrations/", import.meta.url));
const FUNCTIONS = fileURLToPath(new URL("../supabase/sql/functions/", import.meta.url));

/**
 * @param {string} name
 * @returns {RegExp}
 */
function createOf(name) {
  return new RegExp(String.raw`create\s+(?:or\s+replace\s+)?function\s+public\.${name}\s*\(`, "i");
}

/**
 * The argument list of `public.<name>` in `text` with defaults removed, or undefined when the text does not create it.
 * Postgres accepts argument names in a `drop function` list, so they are kept.
 * @param {string} text
 * @param {string} name
 * @returns {string | undefined}
 */
function argumentsOf(text, name) {
  const found = createOf(name).exec(text);
  if (found === null) return undefined;
  let depth = 1;
  let end = found.index + found[0].length;
  for (; end < text.length && depth > 0; end += 1) {
    if (text[end] === "(") depth += 1;
    if (text[end] === ")") depth -= 1;
  }
  const list = text.slice(found.index + found[0].length, end - 1);
  /** @type {string[]} */
  const args = [];
  let current = "";
  depth = 0;
  for (const char of list) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      args.push(current);
      current = "";
    } else current += char;
  }
  args.push(current);
  return args
    .map((arg) =>
      arg
        .replace(/\s+(?:default\b|=)[\s\S]*$/i, "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter((arg) => arg !== "")
    .join(", ");
}

/**
 * The argument list in the latest migration that creates `public.<name>`, or undefined for a new function.
 * @param {string[]} migrations
 * @param {string} name
 * @returns {string | undefined}
 */
function previousArguments(migrations, name) {
  for (const file of [...migrations].reverse()) {
    const args = argumentsOf(readFileSync(`${MIGRATIONS}${file}`, "utf8"), name);
    if (args !== undefined) return args;
  }
  return undefined;
}

/**
 * @param {string[]} argv
 * @returns {{ migrationName: string, names: string[] }}
 */
function parseArgs(argv) {
  const named = argv[0] === "--name";
  const migrationName = named ? argv[1] : undefined;
  const names = named ? argv.slice(2) : argv;
  if ((named && (migrationName === undefined || migrationName === "")) || names.length === 0) {
    throw new Error("usage: bun run db:fn [--name <migration name>] <name> [<name>...]");
  }
  return { migrationName: migrationName ?? `fn_${names[0] ?? ""}`, names };
}

function main() {
  const { migrationName, names } = parseArgs(process.argv.slice(2));
  const missing = names.filter((name) => !existsSync(`${FUNCTIONS}${name}.sql`));
  if (missing.length > 0)
    throw new Error(`no file supabase/sql/functions/<name>.sql for: ${missing.join(" ")}`);

  const before = migrationFiles(readdirSync(MIGRATIONS));
  const parts = names.map((name) => {
    const text = readFileSync(`${FUNCTIONS}${name}.sql`, "utf8").trim();
    const current = argumentsOf(text, name);
    if (current === undefined)
      throw new Error(`supabase/sql/functions/${name}.sql does not create public.${name}`);
    const previous = previousArguments(before, name);
    // A changed signature is a new function to Postgres; the drop keeps the old one from lingering (ruling H43 (1)).
    const drop =
      previous !== undefined && previous.toLowerCase() !== current.toLowerCase()
        ? `drop function if exists public.${name}(${previous});\n\n`
        : "";
    return `${drop}${text}\n`;
  });

  // Every text is read and checked before the CLI makes the file, so a refusal leaves no empty migration behind.
  const created = spawnSync(
    process.execPath,
    ["x", "supabase", "migration", "new", migrationName],
    {
      cwd: APP,
      stdio: "inherit",
    },
  );
  if (created.status !== 0)
    throw new Error(`supabase migration new exited ${String(created.status)}`);
  const added = migrationFiles(readdirSync(MIGRATIONS)).filter((file) => !before.includes(file));
  const target = added[0];
  if (target === undefined || added.length !== 1)
    throw new Error(`expected one new migration, found ${String(added.length)}`);
  const sources = names.map((name) => `supabase/sql/functions/${name}.sql`).join(", ");
  writeFileSync(
    `${MIGRATIONS}${target}`,
    `-- down: re-run bun run db:fn ${names.join(" ")} from the previous commit of ${sources}\n` +
      `set lock_timeout = '5s';\n\n${parts.join("\n")}`,
  );
  console.log(`wrote supabase/migrations/${target}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
