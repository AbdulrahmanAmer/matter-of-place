import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = "supabase/migrations";
const PREFIX = /^(\d{14})_/;
const CONTRACT_HEADER = /^-- contract-of: \d{14}\b/m;
const HEADER_LINES = 30;
// Destructive DDL needs a contract migration (DB-08, STANDARDS R17, ruling ASSUMED H42 (3)).
// Dropping a trigger or a constraint and renaming a policy, trigger, index or constraint stay
// allowed. Postgres makes the COLUMN keyword optional, so the column rules read each clause of an
// `alter table` statement.
/** @type {[string, RegExp][]} */
const STATEMENT_RULES = [
  ["drop table", /\bdrop\s+table\b/i],
  ["drop view", /\bdrop\s+(?:materialized\s+)?view\b/i],
  ["drop type", /\bdrop\s+type\b/i],
  ["drop function", /\bdrop\s+function\b/i],
  ["drop index", /\bdrop\s+index\b/i],
  ["rename", /\balter\s+(?:view|materialized\s+view|type|function)\b[\s\S]*\brename\b/i],
  ["set not null", /\bset\s+not\s+null\b/i],
];
const ALTER_TABLE = /\balter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(?:"[^"]*"|[^\s"])+\s+/i;
/** @type {[string, RegExp][]} */
const CLAUSE_RULES = [
  ["drop column", /^drop\s+(?!constraint\b)/i],
  ["rename", /^rename\s+(?!constraint\b)/i],
  ["column type", /^alter\s+(?:column\s+)?(?:"[^"]*"|[^\s"])+\s+(?:set\s+data\s+)?type\b/i],
  [
    "not null column without a default",
    /^add\s+(?!constraint\b|check\b)(?![\s\S]*\b(?:default|generated|(?:small|big)?serial[248]?)\b)[\s\S]*\bnot\s+null\b/i,
  ],
];
// A DO block runs its body while the migration runs; a function body runs later and is not read.
const DO_BLOCK = /^do\b/i;
const DOLLAR_TAG = /\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/y;
const WORD_CHAR = /[A-Za-z0-9_$]/;

/**
 * @param {string} path
 * @returns {string | undefined}
 */
function prefixOf(path) {
  return PREFIX.exec(basename(path))?.[1];
}

/**
 * The index just after the block comment that opens at `start`; Postgres nests block comments.
 * @param {string} sql
 * @param {number} start
 * @returns {number}
 */
function blockCommentEnd(sql, start) {
  let depth = 0;
  let index = start;
  while (index < sql.length) {
    const pair = sql.slice(index, index + 2);
    if (pair === "/*") {
      depth += 1;
      index += 2;
    } else if (pair === "*/") {
      depth -= 1;
      index += 2;
      if (depth === 0) {
        return index;
      }
    } else {
      index += 1;
    }
  }
  return index;
}

/**
 * The text of the quoted run that opens at `start`, and the index after its closing quote.
 * A doubled quote reads as a close and a new open, which keeps the text whole for the scan.
 * @param {string} sql
 * @param {number} start
 * @param {boolean} backslash an `E'...'` string, where a backslash escapes the next character
 * @returns {{ body: string, end: number }}
 */
function quoted(sql, start, backslash) {
  const quote = sql.charAt(start);
  let index = start + 1;
  while (index < sql.length && sql.charAt(index) !== quote) {
    index += backslash && sql.charAt(index) === "\\" ? 2 : 1;
  }
  return { body: sql.slice(start + 1, index), end: index + 1 };
}

/**
 * Splits SQL into statements. Comments go; every string, quoted name and dollar-quoted body is
 * replaced by an empty one in `text`, and the string and body texts are kept in `literals`.
 * @param {string} sql
 * @returns {{ text: string, literals: string[] }[]}
 */
function statementsOf(sql) {
  /** @type {{ text: string, literals: string[] }[]} */
  const statements = [];
  let text = "";
  /** @type {string[]} */
  let literals = [];
  let index = 0;
  while (index < sql.length) {
    const char = sql.charAt(index);
    const pair = sql.slice(index, index + 2);
    const previous = sql.charAt(index - 1);
    DOLLAR_TAG.lastIndex = index;
    const tag = char === "$" && !WORD_CHAR.test(previous) ? DOLLAR_TAG.exec(sql) : null;
    if (pair === "--") {
      const newline = sql.indexOf("\n", index);
      index = newline === -1 ? sql.length : newline;
    } else if (pair === "/*") {
      text += " ";
      index = blockCommentEnd(sql, index);
    } else if (char === "'") {
      const escaped = /[eE]/.test(previous) && !WORD_CHAR.test(sql.charAt(index - 2));
      const { body, end } = quoted(sql, index, escaped);
      literals.push(body);
      text += "''";
      index = end;
    } else if (char === '"') {
      text += '""';
      index = quoted(sql, index, false).end;
    } else if (tag !== null) {
      const close = sql.indexOf(tag[0], index + tag[0].length);
      const end = close === -1 ? sql.length : close;
      literals.push(sql.slice(index + tag[0].length, end));
      text += "''";
      index = end + tag[0].length;
    } else if (char === ";") {
      statements.push({ text: text.trim(), literals });
      text = "";
      literals = [];
      index += 1;
    } else {
      text += char;
      index += 1;
    }
  }
  statements.push({ text: text.trim(), literals });
  return statements.filter((statement) => statement.text !== "");
}

/**
 * Splits the actions of an `alter table` statement on the commas outside parentheses.
 * @param {string} text
 * @returns {string[]}
 */
function clausesOf(text) {
  /** @type {string[]} */
  const clauses = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text.charAt(index);
    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
    } else if (char === "," && depth === 0) {
      clauses.push(text.slice(start, index).trim());
      start = index + 1;
    }
  }
  clauses.push(text.slice(start).trim());
  return clauses;
}

/**
 * The destructive kinds in `sql`. Inside a DO block every string is read as SQL too, because
 * `execute '<statement>'` is how a DO block runs conditional DDL.
 * @param {string} sql
 * @param {boolean} inDoBlock
 * @returns {string[]}
 */
function destructiveKinds(sql, inDoBlock) {
  return statementsOf(sql).flatMap(({ text, literals }) => {
    const head = ALTER_TABLE.exec(text);
    const clauses = head === null ? [] : clausesOf(text.slice(head.index + head[0].length));
    const own = [
      ...STATEMENT_RULES.filter(([, rule]) => rule.test(text)),
      ...CLAUSE_RULES.filter(([, rule]) => clauses.some((clause) => rule.test(clause))),
    ].map(([kind]) => kind);
    const inner =
      inDoBlock || DO_BLOCK.test(text)
        ? literals.flatMap((literal) => destructiveKinds(literal, true))
        : [];
    return [...own, ...inner];
  });
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
    const kinds = [...new Set(destructiveKinds(text, false))];
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
