import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = "supabase/migrations";
const PREFIX = /^(\d{14})_/;
const CONTRACT_HEADER = /^-- contract-of: (\d{14})\b/m;
const HEADER_LINES = 30;
// Destructive DDL needs a contract migration (DB-08, STANDARDS R17, rulings ASSUMED H42 (3), H43,
// H44). Every drop and rename of an object counts, and `truncate`, except dropping a trigger (R17)
// or a policy, renaming a policy, trigger, index or constraint, and dropping a function or
// procedure that a later statement of the same file creates again, without `cascade`. A statement
// starts the text, or follows a PL/pgSQL keyword inside a DO or function body.
const START = String.raw`(?:^|\b(?:begin|then|else|loop)\s+)`;
const DROP = new RegExp(
  String.raw`${START}drop\s+(?!trigger\b|policy\b)(materialized\s+view|foreign\s+table|\w+)`,
  "i",
);
// `bun run db:fn` writes `drop function if exists public.<name>(<old types>);` before the new
// `create function` when a signature changes (H43 (1)). A drop with `cascade` also removes every
// view, policy, default and generated column that uses the function, so it is never excepted.
const ROUTINE_DROP = new RegExp(
  String.raw`${START}drop\s+(?:function|procedure|routine)\s+(?:if\s+exists\s+)?`,
  "i",
);
const ROUTINE_NAME = /^(?:([\w$]+)\s*\.\s*)?([A-Za-z_][\w$]*)/;
const CASCADE = /\bcascade$/i;
/** @type {[string, RegExp][]} */
const STATEMENT_RULES = [
  [
    "rename",
    new RegExp(
      String.raw`${START}alter\s+(?!policy\b|trigger\b|index\b|(?:foreign\s+)?table\b)[\s\S]*\brename\b`,
      "i",
    ),
  ],
  [
    "drop attribute",
    new RegExp(String.raw`${START}alter\s+type\b[\s\S]*\bdrop\s+attribute\b`, "i"),
  ],
  [
    "attribute type",
    new RegExp(String.raw`${START}alter\s+type\b[\s\S]*\balter\s+attribute\b`, "i"),
  ],
  ["set not null", /\bset\s+not\s+null\b/i],
  ["truncate", new RegExp(String.raw`${START}truncate\b`, "i")],
];
// Postgres makes the COLUMN keyword optional, so the column rules read each clause of the
// statement, and a column may be named `type`.
const ALTER_TABLE =
  /\balter\s+(?:foreign\s+)?table\s+(?:if\s+exists\s+)?(?:only\s+)?(?:"[^"]*"|[^\s"])+\s+/i;
/** @type {[string, RegExp][]} */
const CLAUSE_RULES = [
  ["drop column", /^drop\s+(?!constraint\b)/i],
  ["rename", /^rename\s+(?!constraint\b)/i],
  [
    "column type",
    /^alter\s+(?:column\s+|(?!column\s))(?:"[^"]*"|[^\s"])+\s+(?:set\s+data\s+)?type\b/i,
  ],
  [
    "not null column without a default",
    /^add\s+(?!constraint\b|check\b)(?![\s\S]*\b(?:default|generated|(?:small|big)?serial[248]?)\b(?<!\bset\s+default))[\s\S]*\bnot\s+null\b/i,
  ],
];
// A DO block runs its body while the migration runs. A function body runs when it is called, so
// it is read when another statement of the same file names the function, apart from the
// statements that only declare, grant or describe it.
const DO_BLOCK = /^do\b/i;
const CREATE_FUNCTION = new RegExp(
  String.raw`${START}create\s+(?:or\s+replace\s+)?(?:function|procedure)\s+(?:([\w$]+)\s*\.\s*)?([A-Za-z_][\w$]*)\s*\(`,
  "i",
);
const DECLARES = new RegExp(
  String.raw`${START}(?:create\s+(?:or\s+replace\s+)?(?:function|procedure)|(?:alter|drop)\s+(?:function|procedure|routine)|grant|revoke|comment)\b`,
  "i",
);
// W8 0h (Supabase's notice of 2026-10-20): from 2026-10-30 a new table in `public` is not reachable through the Data
// API without an explicit grant. A table an added file creates in `public` (a partition aside, it is read through its
// parent) is granted to `service_role` in the same file, and to `authenticated` for every operation its row of
// `tests/db/rls-matrix.ts` names. A temporary table lives in no schema the API serves.
const CREATE_TABLE =
  /^create\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?(?:([\w$]+)\s*\.\s*)?([A-Za-z_][\w$]*)/i;
const PARTITION_OF = /^create\s+(?:unlogged\s+)?table\s+[^(]*\bpartition\s+of\b/i;
const GRANT =
  /^grant\s+([\s\S]+?)\s+on\s+([\s\S]+?)\s+to\s+([\s\S]+?)(?:\s+with\s+grant\s+option)?$/i;
const ALL_IN_SCHEMA = /^all\s+tables\s+in\s+schema\s+([\w$]+)$/i;
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
 * Each run of blanks in `text` becomes one space, so a rule's lookahead after `\s+` cannot be
 * met by backtracking into the run. The quoted names are kept in `names`, in order.
 * @param {string} sql
 * @returns {{ text: string, literals: string[], names: string[] }[]}
 */
function statementsOf(sql) {
  /** @type {{ text: string, literals: string[], names: string[] }[]} */
  const statements = [];
  let text = "";
  /** @type {string[]} */
  let literals = [];
  /** @type {string[]} */
  let names = [];
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
      const { body, end } = quoted(sql, index, false);
      names.push(body);
      text += '""';
      index = end;
    } else if (tag !== null) {
      const close = sql.indexOf(tag[0], index + tag[0].length);
      const end = close === -1 ? sql.length : close;
      literals.push(sql.slice(index + tag[0].length, end));
      text += "''";
      index = end + tag[0].length;
    } else if (char === ";") {
      statements.push({ text: text.trim(), literals, names });
      text = "";
      literals = [];
      names = [];
      index += 1;
    } else {
      text += char;
      index += 1;
    }
  }
  statements.push({ text: text.trim(), literals, names });
  return statements
    .map((statement) => ({ ...statement, text: statement.text.replace(/\s+/g, " ") }))
    .filter((statement) => statement.text !== "");
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
 * The bodies of the functions and procedures the statements create, by lower-case name. A name
 * created twice keeps both bodies, since a call between the two runs the first.
 * @param {{ text: string, literals: string[] }[]} statements
 * @returns {Map<string, string[]>}
 */
function bodiesOf(statements) {
  /** @type {Map<string, string[]>} */
  const bodies = new Map();
  for (const { text, literals } of statements) {
    const name = CREATE_FUNCTION.exec(text)?.[2]?.toLowerCase();
    if (name !== undefined) {
      bodies.set(name, [...(bodies.get(name) ?? []), ...literals]);
    }
  }
  return bodies;
}

/**
 * A routine name with its schema, in lower case; a name written without one is read as
 * `public`, the schema the migrations create in.
 * @param {string | undefined} schema
 * @param {string} name
 * @returns {string}
 */
function qualified(schema, name) {
  return `${(schema ?? "public").toLowerCase()}.${name.toLowerCase()}`;
}

/**
 * For each statement, the qualified names of the functions and procedures that the statements
 * after it create.
 * @param {{ text: string }[]} statements
 * @returns {Set<string>[]}
 */
function createdAfter(statements) {
  /** @type {Set<string>[]} */
  const after = [];
  /** @type {Set<string>} */
  let names = new Set();
  for (let index = statements.length - 1; index >= 0; index -= 1) {
    after[index] = names;
    const match = CREATE_FUNCTION.exec(statements[index]?.text ?? "");
    const name = match?.[2];
    if (name !== undefined) {
      names = new Set([...names, qualified(match?.[1], name)]);
    }
  }
  return after;
}

/**
 * Whether the statement drops functions or procedures without `cascade`, and a later statement
 * of the file creates one of every name it drops. A name in quotes is blanked by the lexer, so
 * it never counts as created.
 * @param {string} text
 * @param {Set<string>} created names the statements after this one create
 * @returns {boolean}
 */
function recreates(text, created) {
  const head = ROUTINE_DROP.exec(text);
  return (
    head !== null &&
    !CASCADE.test(text) &&
    clausesOf(text.slice(head.index + head[0].length)).every((target) => {
      const match = ROUTINE_NAME.exec(target);
      const name = match?.[2];
      return name !== undefined && created.has(qualified(match?.[1], name));
    })
  );
}

/**
 * The destructive kinds in the statements. Inside a DO block or a called body every string is
 * read as SQL too, because `execute '<statement>'` is how such a body runs conditional DDL.
 * @param {{ text: string, literals: string[] }[]} statements
 * @param {boolean} inDoBlock
 * @param {Map<string, string[]>} bodies functions of the file a statement may call
 * @param {(index: number) => Set<string>} createdLater names of the functions and procedures
 *   the file creates after the statement at `index`; a body read inside one statement keeps
 *   that statement's set
 * @returns {string[]}
 */
function destructiveKinds(statements, inDoBlock, bodies, createdLater) {
  return statements.flatMap(({ text, literals }, index) => {
    const created = createdLater(index);
    /**
     * @param {string} literal
     * @param {Map<string, string[]>} callable
     */
    const read = (literal, callable) =>
      destructiveKinds(statementsOf(literal), true, callable, () => created);
    const head = ALTER_TABLE.exec(text);
    const clauses = head === null ? [] : clausesOf(text.slice(head.index + head[0].length));
    const dropped = DROP.exec(text)?.[1]?.replace(/^(?:materialized|foreign)\s+/i, "");
    const own = [
      ...(dropped === undefined || recreates(text, created)
        ? []
        : [`drop ${dropped.toLowerCase()}`]),
      ...STATEMENT_RULES.filter(([, rule]) => rule.test(text)).map(([kind]) => kind),
      ...CLAUSE_RULES.filter(([, rule]) => clauses.some((clause) => rule.test(clause))).map(
        ([kind]) => kind,
      ),
    ];
    const inner =
      inDoBlock || DO_BLOCK.test(text) ? literals.flatMap((literal) => read(literal, bodies)) : [];
    const called = DECLARES.test(text)
      ? []
      : [...bodies]
          .filter(([name]) =>
            new RegExp(String.raw`\b${name.replaceAll("$", "\\$")}\s*\(`, "i").test(text),
          )
          .flatMap(([name, body]) => {
            const others = new Map([...bodies].filter(([other]) => other !== name));
            return body.flatMap((literal) => read(literal, others));
          });
    return [...own, ...inner, ...called];
  });
}

/**
 * A statement's text with each quoted name back in place without its quotes (W8 0h gaps review:
 * `public."Ledger"` and `to "service_role"` are read as written), for the grant rule only.
 * @param {{ text: string, names: string[] }} statement
 * @returns {string}
 */
function unquoted({ text, names }) {
  let next = 0;
  return text.replace(/""/g, () => names[next++] ?? "");
}

/**
 * What each statement grants: its privileges (a column grant, `select (a, b)`, read as its
 * privilege), the tables it names (or `*` for every table of `public`) and its roles, all in
 * lower case.
 * @param {{ text: string, names: string[] }[]} statements
 * @returns {{ privileges: string[], tables: string[], roles: string[] }[]}
 */
function grantsOf(statements) {
  return statements.flatMap((statement) => {
    const match = GRANT.exec(unquoted(statement));
    if (match === null) return [];
    const target = (match[2] ?? "").replace(/^table\s+/i, "");
    const schema = ALL_IN_SCHEMA.exec(target)?.[1];
    /** @param {string} list */
    const items = (list) => list.split(",").map((item) => item.trim().toLowerCase());
    return [
      {
        privileges: items((match[1] ?? "").replace(/\s*\([^)]*\)/g, "")).map((item) =>
          item.replace(/\s+privileges$/, ""),
        ),
        tables:
          schema === undefined
            ? items(target).map((name) => qualified(...splitName(name)))
            : schema.toLowerCase() === "public"
              ? ["*"]
              : [],
        roles: items(match[3] ?? ""),
      },
    ];
  });
}

/**
 * @param {string} name
 * @returns {[string | undefined, string]}
 */
function splitName(name) {
  const dot = name.indexOf(".");
  return dot < 0 ? [undefined, name] : [name.slice(0, dot), name.slice(dot + 1)];
}

/**
 * The tables a file creates in `public` that it does not grant as the Data API needs (W8 0h):
 * `service_role` any privilege, `authenticated` each operation of the table's matrix row.
 * @param {{ text: string, names: string[] }[]} statements
 * @param {Record<string, Partial<Record<string, readonly string[]>>>} matrix
 * @returns {string[]}
 */
function ungranted(statements, matrix) {
  const grants = grantsOf(statements);
  return statements.flatMap((statement) => {
    const text = unquoted(statement);
    const match = CREATE_TABLE.exec(text);
    const name = match?.[2];
    if (name === undefined || PARTITION_OF.test(text)) return [];
    const table = qualified(match?.[1], name);
    if (!table.startsWith("public.")) return [];
    /** @param {string} role */
    const held = (role) =>
      grants
        .filter((grant) => grant.roles.includes(role))
        .filter((grant) => grant.tables.includes(table) || grant.tables.includes("*"))
        .flatMap((grant) => grant.privileges);
    const service = held("service_role");
    const authenticated = held("authenticated");
    const needed = Object.entries(matrix[name.toLowerCase()] ?? {})
      .filter(([, roles]) => (roles ?? []).length > 0)
      .map(([operation]) => operation)
      .filter((operation) => !authenticated.includes("all") && !authenticated.includes(operation));
    return [
      ...(service.length === 0
        ? [`${table} is not granted to service_role in its own file (the Data API needs it)`]
        : []),
      ...(needed.length === 0
        ? []
        : [
            `${table} is not granted ${needed.join(", ")} to authenticated in its own file (its RLS matrix row says so)`,
          ]),
    ];
  });
}

/**
 * The rules of the `migration-order` step (B1b invariant 13, DO-05). Paths are relative to `app/`.
 * @param {{
 *   changed: string[],
 *   added: string[],
 *   mainPrefixes: string[],
 *   readFile: (path: string) => string,
 *   matrix?: Record<string, Partial<Record<string, readonly string[]>>> | undefined,
 * }} input `changed`: files on `origin/main` this branch modified, deleted or renamed;
 *   `added`: new files; `mainPrefixes`: the 14-digit versions on `origin/main`; `matrix`: the
 *   rows of `tests/db/rls-matrix.ts`.
 * @returns {string[]}
 */
export function checkMigrations({ changed, added, mainPrefixes, readFile, matrix = {} }) {
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
    const statements = statementsOf(text);
    const bodies = bodiesOf(statements);
    const after = createdAfter(statements);
    const kinds = [
      ...new Set(destructiveKinds(statements, false, bodies, (index) => after[index] ?? new Set())),
    ];
    if (kinds.length > 0) {
      const version = CONTRACT_HEADER.exec(header)?.[1];
      if (version === undefined) {
        failures.push(
          `destructive change (${kinds.join(", ")}) without "-- contract-of: <14-digit version>" in its first ${String(HEADER_LINES)} lines: ${file}`,
        );
      } else if (!mainPrefixes.includes(version)) {
        failures.push(`contract-of names a version that is not on main: ${file}`);
      }
    }
    for (const missing of ungranted(statements, matrix)) {
      failures.push(`${missing}: ${file}`);
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
    const { rlsMatrix } = await import("../tests/db/rls-matrix.ts");
    const failures = checkMigrations({
      changed,
      added,
      mainPrefixes: onMain.flatMap((file) => prefixOf(file) ?? []),
      readFile: (path) => readFileSync(path, "utf8"),
      matrix: rlsMatrix,
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
