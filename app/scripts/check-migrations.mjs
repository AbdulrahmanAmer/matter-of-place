import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = "supabase/migrations";
const PREFIX = /^(\d{14})_/;
const CONTRACT_HEADER = /^-- contract-of: \d{14}\b/m;
const HEADER_LINES = 30;
const LINE_COMMENT = /--.*$/gm;
// Destructive DDL needs a contract migration (DB-08, STANDARDS R17, ruling ASSUMED H42 (3)).
// Dropping a trigger or a constraint stays allowed. Postgres makes the COLUMN keyword optional,
// so the column rules read each clause of an `alter table` statement.
/** @type {[string, RegExp][]} */
const STATEMENT_RULES = [
  ["drop table", /\bdrop\s+table\b/i],
  ["drop view", /\bdrop\s+(?:materialized\s+)?view\b/i],
  ["drop type", /\bdrop\s+type\b/i],
  ["drop function", /\bdrop\s+function\b/i],
  ["drop index", /\bdrop\s+index\b/i],
  ["rename", /\brename\b/i],
  ["set not null", /\bset\s+not\s+null\b/i],
];
const ALTER_TABLE = /^alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(?:"[^"]*"|[^\s"])+\s+/i;
/** @type {[string, RegExp][]} */
const CLAUSE_RULES = [
  ["drop column", /^drop\s+(?!constraint\b)/i],
  ["column type", /^alter\s+(?:column\s+)?(?:"[^"]*"|[^\s"])+\s+(?:set\s+data\s+)?type\b/i],
  [
    "not null column without a default",
    /^add\s+(?!constraint\b|check\b)(?![\s\S]*\b(?:default|generated)\b)[\s\S]*\bnot\s+null\b/i,
  ],
];

/**
 * @param {string} path
 * @returns {string | undefined}
 */
function prefixOf(path) {
  return PREFIX.exec(basename(path))?.[1];
}

/**
 * Splits `text` on `separator` outside parentheses and quotes.
 * @param {string} text
 * @param {string} separator
 * @returns {string[]}
 */
function splitTopLevel(text, separator) {
  /** @type {string[]} */
  const parts = [];
  let depth = 0;
  let quote = "";
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote !== "") {
      if (char === quote) {
        quote = "";
      }
    } else if (char === "'" || char === '"') {
      quote = char;
    } else if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
    } else if (char === separator && depth === 0) {
      parts.push(text.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(text.slice(start).trim());
  return parts;
}

/**
 * The destructive kinds in a migration's statements, comments already removed.
 * @param {string} statements
 * @returns {string[]}
 */
function destructiveKinds(statements) {
  const clauses = splitTopLevel(statements, ";").flatMap((statement) => {
    const head = ALTER_TABLE.exec(statement);
    return head === null ? [] : splitTopLevel(statement.slice(head[0].length), ",");
  });
  return [
    ...STATEMENT_RULES.filter(([, rule]) => rule.test(statements)),
    ...CLAUSE_RULES.filter(([, rule]) => clauses.some((clause) => rule.test(clause))),
  ].map(([kind]) => kind);
}

/**
 * The rules of the `migration-order` step (B1b invariant 13, DO-05). Paths are relative to `app/`.
 * @param {{
 *   changed: string[],
 *   added: string[],
 *   mainPrefixes: string[],
 *   readFile: (path: string) => string,
 * }} input `changed`: files on `origin/main` this branch modified, deleted or renamed;
 *   `added`: new files; `mainPrefixes`: the 14-digit versions on `origin/main`.
 * @returns {string[]}
 */
export function checkMigrations({ changed, added, mainPrefixes, readFile }) {
  /** @type {string[]} */
  const failures = changed.map((file) => `applied migration changed: ${file}`);
  const latest = mainPrefixes.reduce((max, prefix) => (prefix > max ? prefix : max), "");
  for (const file of added) {
    const prefix = prefixOf(file);
    if (prefix === undefined || prefix <= latest) {
      failures.push(`rename ${file} to a timestamp after ${latest}`);
    }
    const text = readFile(file);
    const header = text.split("\n").slice(0, HEADER_LINES).join("\n");
    // The `-- down:` header of an expand migration names its drop; comments are not DDL.
    const statements = text.replace(LINE_COMMENT, "");
    const kinds = destructiveKinds(statements);
    if (kinds.length > 0 && !CONTRACT_HEADER.test(header)) {
      failures.push(
        `destructive change (${kinds.join(", ")}) without "-- contract-of: <14-digit version>" in its first ${String(HEADER_LINES)} lines: ${file}`,
      );
    }
  }
  return failures;
}

/**
 * @param {string[]} args
 * @returns {string[]}
 */
function git(args) {
  return execFileSync("git", args, { encoding: "utf8" })
    .split("\n")
    .filter((line) => line.endsWith(".sql"));
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const range = ["diff", "--relative", "--name-only", "origin/main...HEAD"];
  const changed = git([...range, "--diff-filter=MDR", "--", DIR]);
  const added = git([...range, "--diff-filter=A", "--", DIR]);
  const onMain = git(["ls-tree", "--name-only", "origin/main", `${DIR}/`]);
  if (changed.length + added.length + onMain.length === 0) {
    process.stdout.write("no migrations\n");
  } else {
    const failures = checkMigrations({
      changed,
      added,
      mainPrefixes: onMain.flatMap((file) => prefixOf(file) ?? []),
      readFile: (path) => readFileSync(path, "utf8"),
    });
    for (const failure of failures) {
      process.stdout.write(`${failure}\n`);
    }
    if (failures.length > 0) {
      process.exit(1);
    }
    process.stdout.write(
      `migration-order: OK (${String(onMain.length)} on main, ${String(added.length)} added)\n`,
    );
  }
}
