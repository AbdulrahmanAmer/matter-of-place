import { execFileSync, spawn } from "node:child_process";
import { appendFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { parseArgs } from "node:util";

// Watched-fail (RULE 2): break the code a test covers, see the test go red for the right reason, put the code back.
// `node scripts/watchfail.mjs --file <path> --find "<text>" --replace "<text>" --run "<command>" --expect "<regex>"
//    [--after "<command>"] [--record "<test name>"]`
// `node scripts/watchfail.mjs --registry tests/mutations [--only <id>] [--changed <ref>] [--kinds unit,sql]`
// Exit 0 when every replay is red for the expected reason, 1 on a BAD one, 2 on a stale `find`, 64 on a usage error.

const LEDGER = "tests/WATCHED-FAIL.md";
const KINDS = ["file", "sql", "manual"];
const LEADING_ASSIGNMENTS = /^(?:[A-Za-z_][A-Za-z0-9_]*=[^\s"']*\s+)+/;
const TAIL_LINES = 30;

/**
 * @typedef {{
 *   id: string,
 *   kind?: "file" | "sql" | "manual",
 *   test: string,
 *   file?: string,
 *   find?: string,
 *   replace?: string,
 *   sql?: string,
 *   run: string,
 *   expect: string,
 *   after?: string,
 * }} Entry
 * @typedef {"ok" | "bad" | "stale"} Outcome
 * @typedef {{ outcome: Outcome, observed: string }} Verdict
 * @typedef {{ code: number, output: string }} Finished
 */

/**
 * @param {unknown} value
 * @returns {value is string}
 */
const isText = (value) => typeof value === "string" && value !== "";

/**
 * What is wrong with a registry entry, one sentence each; an empty list means it can be replayed.
 * @param {unknown} entry
 * @returns {string[]}
 */
export function entryProblems(entry) {
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return ["not an object"];
  /** @type {Record<string, unknown>} */
  const fields = { ...entry };
  /** @type {string[]} */
  const problems = [];
  for (const key of ["id", "test", "run", "expect"]) {
    if (!isText(fields[key])) problems.push(`missing ${key}`);
  }
  const kind = fields["kind"];
  if (kind !== undefined && !(typeof kind === "string" && KINDS.includes(kind))) {
    problems.push(`unknown kind ${JSON.stringify(kind)}`);
  }
  if (kind === "sql") {
    if (!isText(fields["sql"])) problems.push("sql entry without sql");
  } else if (kind !== "manual") {
    if (!isText(fields["file"])) problems.push("file entry without file");
    if (!isText(fields["find"])) problems.push("file entry without find");
    if (typeof fields["replace"] !== "string") problems.push("file entry without replace");
  }
  if (fields["after"] !== undefined && !isText(fields["after"])) problems.push("after is not text");
  if (isText(fields["expect"])) {
    try {
      new RegExp(fields["expect"]);
    } catch {
      problems.push("expect is not a regular expression");
    }
  }
  return problems;
}

/**
 * Every `*.json` of the registry folder, by file name.
 * @param {string} dir
 * @returns {{ registry: string, entries: unknown[] }[]}
 */
export function loadRegistries(dir) {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => {
      /** @type {unknown} */
      const parsed = JSON.parse(readFileSync(join(dir, name), "utf8"));
      return { registry: basename(name, ".json"), entries: Array.isArray(parsed) ? parsed : [] };
    });
}

/**
 * `unit` is every file entry, `sql` runs inside the test's rolled-back transaction, `manual` is recorded and never replayed.
 * @param {Entry} entry
 * @returns {"unit" | "sql" | "manual"}
 */
function kindOf(entry) {
  if (entry.kind === "sql" || entry.kind === "manual") return entry.kind;
  return "unit";
}

/**
 * @param {string} text
 * @param {string} find
 * @returns {number}
 */
function occurrences(text, find) {
  let count = 0;
  for (let at = text.indexOf(find); at !== -1; at = text.indexOf(find, at + 1)) count += 1;
  return count;
}

/**
 * @param {string} command a shell command that may start with `NAME=value` assignments
 * @param {Record<string, string>} extraEnv
 * @returns {Promise<Finished>}
 */
function execute(command, extraEnv) {
  const assignments = LEADING_ASSIGNMENTS.exec(command)?.[0] ?? "";
  /** @type {Record<string, string>} */
  const given = {};
  for (const word of assignments.trim().split(/\s+/)) {
    const at = word.indexOf("=");
    if (at > 0) given[word.slice(0, at)] = word.slice(at + 1);
  }
  /** @type {Record<string, string | undefined>} */
  const env = { ...process.env, ...given, ...extraEnv, NO_COLOR: "1", FORCE_COLOR: undefined };
  return new Promise((done) => {
    const child = spawn(command.slice(assignments.length), { shell: true, env });
    let output = "";
    child.stdout.on("data", (chunk) => (output += String(chunk)));
    child.stderr.on("data", (chunk) => (output += String(chunk)));
    child.on("error", (error) => {
      done({ code: 1, output: error.message });
    });
    child.on("close", (code) => {
      done({ code: code ?? 1, output });
    });
  });
}

/**
 * The bytes to put back, by path, for every file a replay has mutated right now.
 * @type {Map<string, Buffer>}
 */
const mutatedNow = new Map();

function restoreAll() {
  for (const [path, bytes] of mutatedNow) writeFileSync(path, bytes);
  mutatedNow.clear();
}

/**
 * @param {string} output
 * @returns {string}
 */
function tail(output) {
  return output.trimEnd().split(/\r?\n/).slice(-TAIL_LINES).join("\n");
}

/**
 * @param {string} label
 * @param {string} why
 * @returns {Verdict}
 */
function stale(label, why) {
  console.log(`STALE ${label}: ${why}`);
  return { outcome: "stale", observed: `stale: ${why}` };
}

/**
 * @param {string} label
 * @param {string} reason
 * @param {string} shown
 * @returns {Verdict}
 */
function bad(label, reason, shown) {
  console.log(`WATCHED-FAIL BAD: ${reason} (${label})`);
  if (shown !== "") console.log(shown);
  return { outcome: "bad", observed: `BAD: ${reason}` };
}

/**
 * Writes the mutation, runs the command, puts the file back. A `sql` entry only runs the command.
 * @param {Entry} entry
 * @param {string} label
 * @returns {Promise<Finished | Verdict>}
 */
async function runMutated(entry, label) {
  if (entry.kind === "sql") return execute(entry.run, { MOP_MUTATION_SQL: entry.sql ?? "" });
  const file = entry.file ?? "";
  const find = entry.find ?? "";
  const replace = entry.replace ?? "";
  const path = resolve(file);
  if (!existsSync(path)) return stale(label, `${file} does not exist`);
  const original = readFileSync(path);
  const text = original.toString("utf8");
  const count = occurrences(text, find);
  if (count !== 1) return stale(label, `find occurs ${String(count)} times in ${file}`);
  if (find === replace) return stale(label, "replace equals find");
  const start = text.indexOf(find);
  const changed = text.slice(0, start) + replace + text.slice(start + find.length);
  const line = text.slice(0, start).split("\n").length;
  mutatedNow.set(path, original);
  writeFileSync(path, changed);
  const shown = changed.split("\n")[line - 1]?.trim().slice(0, 100) ?? "";
  console.log(`  mutated ${file}:${String(line)}  ${shown}`);
  try {
    return await execute(entry.run, {});
  } finally {
    restoreAll();
  }
}

/**
 * Applies the mutation, runs the command, restores the file, runs `after`. Prints the verdict.
 * @param {Entry} entry
 * @param {string} label
 * @returns {Promise<Verdict>}
 */
async function replay(entry, label) {
  const finished = await runMutated(entry, label);
  if ("outcome" in finished) return finished;
  if (finished.code === 0) return bad(label, "stayed green", "");
  if (!new RegExp(entry.expect).test(finished.output)) {
    const shown = `expected /${entry.expect}/ in the output of the red run:\n${tail(finished.output)}`;
    return bad(label, "wrong reason", shown);
  }
  if (entry.after !== undefined) {
    const again = await execute(entry.after, {});
    if (again.code !== 0) return bad(label, "after command failed", tail(again.output));
  }
  console.log(`WATCHED-FAIL OK ${label}`);
  return { outcome: "ok", observed: `red, output matched /${entry.expect}/` };
}

/**
 * @param {{ test: string, entry: Entry, observed: string }} row
 */
function appendLedger({ test, entry, observed }) {
  if (!existsSync(LEDGER)) throw new Error(`ledger ${LEDGER} not found`);
  const mutation =
    entry.kind === "sql"
      ? `sql: ${JSON.stringify(entry.sql)}`
      : `${entry.file ?? ""}: ${JSON.stringify(entry.find)} → ${JSON.stringify(entry.replace)}`;
  const date = new Date().toISOString().slice(0, 10);
  const cells = [date, test, mutation, `/${entry.expect}/`, observed].map((cell) =>
    cell.replaceAll("|", "\\|").replaceAll("\n", " "),
  );
  const text = readFileSync(LEDGER, "utf8");
  appendFileSync(LEDGER, `${text.endsWith("\n") ? "" : "\n"}| ${cells.join(" | ")} |\n`);
}

/**
 * @param {string} message
 * @returns {number}
 */
function usage(message) {
  console.error(`watchfail: ${message}`);
  return 64;
}

/**
 * @param {{ registry: string, only?: string | undefined, changed?: string | undefined, kinds?: string | undefined }} options
 * @returns {Promise<number>}
 */
async function replayRegistry({ registry, only, changed, kinds }) {
  const registries = loadRegistries(resolve(registry));
  if (registries.length === 0) return usage(`no *.json in ${registry}`);
  const touched =
    changed === undefined
      ? undefined
      : new Set(
          execFileSync("git", ["diff", "--name-only", "--relative", `${changed}...HEAD`], {
            encoding: "utf8",
          })
            .split(/\r?\n/)
            .filter(Boolean),
        );
  const wanted = kinds?.split(",");
  const counts = { ok: 0, bad: 0, stale: 0, manual: 0, skipped: 0 };
  for (const { registry: name, entries } of registries) {
    for (const raw of entries) {
      const problems = entryProblems(raw);
      const entry = /** @type {Entry} */ (raw);
      const label = `${name}:${isText(entry.id) ? entry.id : "?"}`;
      if (problems.length > 0) {
        console.log(`STALE ${label}: ${problems.join(", ")}`);
        counts.stale += 1;
        continue;
      }
      const touchedByDiff =
        touched === undefined || touched.has(entry.file ?? "") || touched.has(entry.test);
      if ((only !== undefined && entry.id !== only) || !touchedByDiff) {
        counts.skipped += 1;
      } else if (kindOf(entry) === "manual") {
        counts.manual += 1;
      } else if (wanted !== undefined && !wanted.includes(kindOf(entry))) {
        counts.skipped += 1;
      } else {
        counts[(await replay(entry, label)).outcome] += 1;
      }
    }
  }
  const total = counts.ok + counts.bad + counts.stale;
  console.log(
    `watchfail: replayed ${total.toString()}: ok ${counts.ok.toString()}, bad ${counts.bad.toString()}, stale ${counts.stale.toString()}; manual ${counts.manual.toString()} not replayed; ${counts.skipped.toString()} not selected`,
  );
  if (only !== undefined && total === 0 && counts.manual === 0) {
    return usage(`no entry with id ${only}`);
  }
  return counts.stale > 0 ? 2 : counts.bad > 0 ? 1 : 0;
}

/**
 * @param {string[]} argv
 * @returns {Promise<number>}
 */
async function main(argv) {
  const options = /** @type {const} */ ({
    file: { type: "string" },
    find: { type: "string" },
    replace: { type: "string" },
    run: { type: "string" },
    expect: { type: "string" },
    after: { type: "string" },
    record: { type: "string" },
    registry: { type: "string" },
    only: { type: "string" },
    changed: { type: "string" },
    kinds: { type: "string" },
  });
  let values;
  try {
    ({ values } = parseArgs({ args: argv, strict: true, options }));
  } catch (error) {
    return usage(error instanceof Error ? error.message : String(error));
  }
  if (values.registry !== undefined)
    return replayRegistry({ ...values, registry: values.registry });
  const given = {
    id: "by-hand",
    test: values.record ?? values.file,
    file: values.file,
    find: values.find,
    replace: values.replace,
    run: values.run,
    expect: values.expect,
    after: values.after,
  };
  const problems = entryProblems(given);
  if (problems.length > 0) return usage(problems.join(", "));
  const entry = /** @type {Entry} */ (/** @type {unknown} */ (given));
  const { outcome, observed } = await replay(entry, entry.test);
  if (values.record !== undefined && outcome !== "stale") {
    appendLedger({ test: values.record, entry, observed });
  }
  return outcome === "ok" ? 0 : outcome === "bad" ? 1 : 2;
}

if (import.meta.main) {
  process.on("exit", restoreAll);
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => process.exit(130));
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (/** @type {unknown} */ error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    },
  );
}
