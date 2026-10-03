import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { entryProblems, loadRegistries } from "../../scripts/watchfail.mjs";

const SCRIPT = fileURLToPath(new URL("../../scripts/watchfail.mjs", import.meta.url));

// The tiny project every case runs in: `check.mjs <file>` is the "test" and passes while the file holds `beta`.
const TARGET = "alpha\nbeta\n";
const CHECK = [
  'import { readFileSync } from "node:fs";',
  'const text = readFileSync(process.argv[2] ?? "target.txt", "utf8");',
  'if (text.includes("beta")) process.exit(0);',
  'console.log("broken: no beta in " + JSON.stringify(text));',
  "process.exit(1);",
].join("\n");
const SQL_CHECK = [
  'const sql = process.env["MOP_MUTATION_SQL"] ?? "";',
  'if (sql === "") process.exit(0);',
  'console.log("sql=" + sql);',
  "process.exit(1);",
].join("\n");
const FAIL = 'console.log("after ran");\nprocess.exit(1);\n';
const MARK = [
  'import { appendFileSync, readFileSync } from "node:fs";',
  'const seen = readFileSync("target.txt", "utf8").includes("beta") ? "restored" : "mutated";',
  'appendFileSync("marker.txt", seen);',
].join("\n");
const LEDGER =
  "| Date | Test | Mutation | Expected reason | Observed |\n| --- | --- | --- | --- | --- |\n";

const dirs: string[] = [];

function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "watchfail-"));
  dirs.push(dir);
  const all = {
    "target.txt": TARGET,
    "other.txt": TARGET,
    "check.mjs": CHECK,
    "sql-check.mjs": SQL_CHECK,
    "fail.mjs": FAIL,
    "mark.mjs": MARK,
    ...files,
  };
  for (const [name, text] of Object.entries(all)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  return dir;
}

// `lines` leaves out the "  mutated <file>:<line>" notes, so a case compares the verdict lines only.
function run(dir: string, args: string[]) {
  const done = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: dir, encoding: "utf8" });
  const out = done.stdout + done.stderr;
  const lines = out
    .split("\n")
    .filter((line) => line.trim() !== "" && !line.startsWith("  mutated "));
  return { status: done.status, out, lines };
}

function byHand(over: Record<string, string> = {}): string[] {
  const args = {
    file: "target.txt",
    find: "beta",
    replace: "gamma",
    run: "node check.mjs",
    expect: "broken: no beta",
    ...over,
  };
  return Object.entries(args).flatMap(([name, value]) => [`--${name}`, value]);
}

const entry = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  test: "check.mjs",
  file: "target.txt",
  find: "beta",
  replace: "gamma",
  run: "node check.mjs",
  expect: "broken: no beta",
  ...over,
});
const other = (id: string) => entry(id, { file: "other.txt", run: "node check.mjs other.txt" });
const sqlEntry = {
  id: "q",
  kind: "sql",
  test: "sql-check.mjs",
  sql: "select 1",
  run: "node sql-check.mjs",
  expect: "sql=select 1",
};

function withRegistry(entries: unknown[]): string {
  return project({ "mutations/A.json": JSON.stringify(entries) });
}

const fileOf = (dir: string, name: string) => readFileSync(join(dir, name), "utf8");

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("by hand: --file --find --replace --run --expect", () => {
  it("mutates the file for the run, sees it red, restores the bytes", () => {
    const dir = project({});
    const done = run(dir, byHand());
    expect({
      status: done.status,
      lines: done.lines,
      mutated: done.out.includes("  mutated target.txt:2  gamma"),
      file: fileOf(dir, "target.txt"),
    }).toEqual({ status: 0, lines: ["WATCHED-FAIL OK target.txt"], mutated: true, file: TARGET });
  });

  it("exits 2 and changes nothing when find is absent", () => {
    const dir = project({});
    const done = run(dir, byHand({ find: "delta" }));
    expect({ status: done.status, lines: done.lines, file: fileOf(dir, "target.txt") }).toEqual({
      status: 2,
      lines: ["STALE target.txt: find occurs 0 times in target.txt"],
      file: TARGET,
    });
  });

  it("exits 2 when find occurs more than once", () => {
    const dir = project({});
    const done = run(dir, byHand({ find: "a" }));
    expect({ status: done.status, lines: done.lines }).toEqual({
      status: 2,
      lines: ["STALE target.txt: find occurs 3 times in target.txt"],
    });
  });

  it("exits 2 when the replacement equals find", () => {
    const dir = project({});
    const done = run(dir, byHand({ replace: "beta" }));
    expect({ status: done.status, lines: done.lines }).toEqual({
      status: 2,
      lines: ["STALE target.txt: replace equals find"],
    });
  });

  it("reports BAD: stayed green when the run passes", () => {
    const dir = project({});
    const done = run(dir, byHand({ find: "alpha", replace: "ALPHA" }));
    expect({ status: done.status, lines: done.lines, file: fileOf(dir, "target.txt") }).toEqual({
      status: 1,
      lines: ["WATCHED-FAIL BAD: stayed green (target.txt)"],
      file: TARGET,
    });
  });

  it("reports BAD: wrong reason, with the red run's output", () => {
    const dir = project({});
    const done = run(dir, byHand({ expect: "something else" }));
    expect({ status: done.status, lines: done.lines }).toEqual({
      status: 1,
      lines: [
        "WATCHED-FAIL BAD: wrong reason (target.txt)",
        "expected /something else/ in the output of the red run:",
        'broken: no beta in "alpha\\ngamma\\n"',
      ],
    });
  });

  it("runs --after on the restored file", () => {
    const dir = project({});
    const done = run(dir, byHand({ after: "node mark.mjs" }));
    const marker = existsSync(join(dir, "marker.txt")) ? fileOf(dir, "marker.txt") : "not run";
    expect({ status: done.status, marker }).toEqual({ status: 0, marker: "restored" });
  });

  it("reports BAD when the --after command fails", () => {
    const dir = project({});
    const done = run(dir, byHand({ after: "node fail.mjs" }));
    expect({ status: done.status, lines: done.lines }).toEqual({
      status: 1,
      lines: ["WATCHED-FAIL BAD: after command failed (target.txt)", "after ran"],
    });
  });

  it("appends a ledger row for --record", () => {
    const dir = project({ "tests/WATCHED-FAIL.md": LEDGER });
    const done = run(dir, byHand({ record: "beta stays" }));
    const row = fileOf(dir, "tests/WATCHED-FAIL.md").split("\n")[2] ?? "";
    expect({ status: done.status, row: row.replace(/^\| \d{4}-\d{2}-\d{2} /, "| DATE ") }).toEqual({
      status: 0,
      row: '| DATE | beta stays | target.txt: "beta" → "gamma" | /broken: no beta/ | red, output matched /broken: no beta/ |',
    });
  });

  it("refuses a call without --run and names it", () => {
    const dir = project({});
    const done = run(dir, [
      "--file",
      "target.txt",
      "--find",
      "beta",
      "--replace",
      "gamma",
      "--expect",
      "x",
    ]);
    expect({ status: done.status, lines: done.lines }).toEqual({
      status: 64,
      lines: ["watchfail: missing run"],
    });
  });
});

describe("registry: --registry tests/mutations", () => {
  it("replays every file entry and prints OK for each", () => {
    const dir = withRegistry([entry("one"), other("two")]);
    const done = run(dir, ["--registry", "mutations"]);
    expect({ status: done.status, lines: done.lines }).toEqual({
      status: 0,
      lines: [
        "WATCHED-FAIL OK A:one",
        "WATCHED-FAIL OK A:two",
        "watchfail: replayed 2: ok 2, bad 0, stale 0; manual 0 not replayed; 0 not selected",
      ],
    });
  });

  it("--only replays the one entry with that id", () => {
    const dir = withRegistry([entry("one"), other("two")]);
    const done = run(dir, ["--registry", "mutations", "--only", "two"]);
    expect({ status: done.status, lines: done.lines }).toEqual({
      status: 0,
      lines: [
        "WATCHED-FAIL OK A:two",
        "watchfail: replayed 1: ok 1, bad 0, stale 0; manual 0 not replayed; 1 not selected",
      ],
    });
  });

  it("--only an id no entry has exits 64", () => {
    const dir = withRegistry([entry("one")]);
    const done = run(dir, ["--registry", "mutations", "--only", "nine"]);
    expect({ status: done.status, last: done.lines.at(-1) }).toEqual({
      status: 64,
      last: "watchfail: no entry with id nine",
    });
  });

  it("exits 2 naming the stale entry, and replays the others", () => {
    const dir = withRegistry([entry("one", { find: "delta" }), other("two")]);
    const done = run(dir, ["--registry", "mutations"]);
    expect({ status: done.status, lines: done.lines }).toEqual({
      status: 2,
      lines: [
        "STALE A:one: find occurs 0 times in target.txt",
        "WATCHED-FAIL OK A:two",
        "watchfail: replayed 2: ok 1, bad 0, stale 1; manual 0 not replayed; 0 not selected",
      ],
    });
  });

  it("exits 1 when an entry stays green", () => {
    const dir = withRegistry([entry("one", { find: "alpha", replace: "ALPHA" })]);
    const done = run(dir, ["--registry", "mutations"]);
    expect({ status: done.status, first: done.lines[0] }).toEqual({
      status: 1,
      first: "WATCHED-FAIL BAD: stayed green (A:one)",
    });
  });

  it("never replays a manual entry", () => {
    const dir = withRegistry([entry("one", { kind: "manual", find: "alpha", replace: "ALPHA" })]);
    const done = run(dir, ["--registry", "mutations"]);
    expect({ status: done.status, lines: done.lines }).toEqual({
      status: 0,
      lines: ["watchfail: replayed 0: ok 0, bad 0, stale 0; manual 1 not replayed; 0 not selected"],
    });
  });

  it("reports a malformed entry as stale, not replayed", () => {
    const dir = withRegistry([entry("one", { run: "" })]);
    const done = run(dir, ["--registry", "mutations"]);
    expect({ status: done.status, first: done.lines[0] }).toEqual({
      status: 2,
      first: "STALE A:one: missing run",
    });
  });

  it("runs a sql entry with MOP_MUTATION_SQL set to its sql", () => {
    const dir = withRegistry([sqlEntry]);
    const done = run(dir, ["--registry", "mutations"]);
    expect({ status: done.status, first: done.lines[0] }).toEqual({
      status: 0,
      first: "WATCHED-FAIL OK A:q",
    });
  });

  it("--kinds sql replays only the sql entries", () => {
    const dir = withRegistry([entry("one"), sqlEntry]);
    const done = run(dir, ["--registry", "mutations", "--kinds", "sql"]);
    expect({ status: done.status, lines: done.lines }).toEqual({
      status: 0,
      lines: [
        "WATCHED-FAIL OK A:q",
        "watchfail: replayed 1: ok 1, bad 0, stale 0; manual 0 not replayed; 1 not selected",
      ],
    });
  });

  it("--changed <ref> replays only entries the diff touches", () => {
    const dir = withRegistry([entry("one"), other("two")]);
    const git = (...args: string[]) =>
      spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: dir });
    git("init", "-q");
    git("add", ".");
    git("commit", "-q", "-m", "base");
    writeFileSync(join(dir, "other.txt"), TARGET + "more\n");
    git("commit", "-q", "-am", "touch other");
    const done = run(dir, ["--registry", "mutations", "--changed", "HEAD~1"]);
    expect({ status: done.status, lines: done.lines }).toEqual({
      status: 0,
      lines: [
        "WATCHED-FAIL OK A:two",
        "watchfail: replayed 1: ok 1, bad 0, stale 0; manual 0 not replayed; 1 not selected",
      ],
    });
  });
});

describe("entryProblems", () => {
  const valid = entry("one");
  const manual = { id: "m", kind: "manual", test: "t", run: "r", expect: "e" };

  it.each([
    { name: "a file entry", given: valid, expected: [] },
    { name: "a sql entry", given: sqlEntry, expected: [] },
    { name: "a manual entry without file", given: manual, expected: [] },
    { name: "an empty replace", given: { ...valid, replace: "" }, expected: [] },
    { name: "no id", given: { ...valid, id: "" }, expected: ["missing id"] },
    { name: "no test", given: { ...valid, test: undefined }, expected: ["missing test"] },
    { name: "no expect", given: { ...valid, expect: undefined }, expected: ["missing expect"] },
    {
      name: "no file",
      given: { ...valid, file: undefined },
      expected: ["file entry without file"],
    },
    { name: "an empty find", given: { ...valid, find: "" }, expected: ["file entry without find"] },
    {
      name: "no replace",
      given: { ...valid, replace: undefined },
      expected: ["file entry without replace"],
    },
    {
      name: "a sql entry without sql",
      given: { ...sqlEntry, sql: "" },
      expected: ["sql entry without sql"],
    },
    {
      name: "an unknown kind",
      given: { ...valid, kind: "create" },
      expected: ['unknown kind "create"'],
    },
    {
      name: "an expect that is no regex",
      given: { ...valid, expect: "(" },
      expected: ["expect is not a regular expression"],
    },
    { name: "something that is no object", given: "x", expected: ["not an object"] },
  ])("$name", ({ given, expected }) => {
    expect(entryProblems(given)).toEqual(expected);
  });
});

describe("loadRegistries", () => {
  it("reads every json file in name order and ignores the rest", () => {
    const dir = project({
      "mutations/B.json": JSON.stringify([entry("b")]),
      "mutations/A.json": JSON.stringify([entry("a")]),
      "mutations/notes.md": "x",
    });
    expect(
      loadRegistries(join(dir, "mutations")).map((r) => [r.registry, r.entries.length]),
    ).toEqual([
      ["A", 1],
      ["B", 1],
    ]);
  });
});
