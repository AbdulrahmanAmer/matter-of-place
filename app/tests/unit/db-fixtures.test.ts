import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// H79 (4): no test shares rows. A database case seeds the analytics rows it reads inside its own rolled-back
// transaction, under a path of its own, and never reads a row it did not seed. Three rows of `analytics_events` once
// sat on mop-dev, left by probes, and nothing said which case could rely on them.
//
// The scan reads the SQL of `tests/db`: a statement on `analytics_events` or `analytics_daily` ends at the closing
// backtick, quote or semicolon of its string. A path written as a literal (`'/x'`) is a fixture row. A path built
// per run (`$1` with `/test-${randomUUID()}`) is not a literal and is always the case's own.
const TABLE = /public\.analytics_(?:events|daily)\b/;
const INSERT = /insert\s+into\s+public\.analytics_(?:events|daily)\b/gi;
const READ = /(?:from|update|into)\s+public\.analytics_(?:events|daily)\b/gi;

/** The text of the SQL statement that starts at `start`: to the next backtick, double quote or semicolon. */
function statementAt(text: string, start: number): string {
  const rest = text.slice(start);
  const end = rest.search(/[`";]/);
  return end === -1 ? rest : rest.slice(0, end);
}

/** Every `'/...'` literal in a statement, once each; `'/test-' || some_id` is built per run and is not one. */
function literalPaths(statement: string): string[] {
  return [
    ...new Set([...statement.matchAll(/'(\/[^']*)'(?!\s*\|\|)/g)].map((match) => match[1] ?? "")),
  ];
}

/** The literal paths a file inserts into the analytics tables, and the ones its other statements name. */
function analyticsFixtures(text: string): { seeded: string[]; named: string[] } {
  const seeded = new Set<string>();
  for (const match of text.matchAll(INSERT)) {
    for (const path of literalPaths(statementAt(text, match.index))) seeded.add(path);
  }
  const named = new Set<string>();
  for (const match of text.matchAll(READ)) {
    const statement = statementAt(text, match.index);
    if (!TABLE.test(statement)) continue;
    for (const path of literalPaths(statement)) named.add(path);
  }
  return { seeded: [...seeded], named: [...named] };
}

/** What is wrong across files: a path seeded by two files, and a path named where its file seeds nothing of that name. */
function fixtureProblems(files: Record<string, string>): string[] {
  const owners = new Map<string, string[]>();
  const problems: string[] = [];
  for (const [file, text] of Object.entries(files)) {
    const { seeded, named } = analyticsFixtures(text);
    for (const path of seeded) owners.set(path, [...(owners.get(path) ?? []), file]);
    for (const path of named.filter((entry) => !seeded.includes(entry))) {
      problems.push(`${file} reads ${path}, a row it does not seed`);
    }
  }
  for (const [path, list] of owners) {
    if (list.length > 1) problems.push(`${path} is seeded by ${list.join(" and ")}`);
  }
  return problems;
}

const DB_DIR = new URL("../db/", import.meta.url);

function dbTests(): Record<string, string> {
  return Object.fromEntries(
    readdirSync(DB_DIR)
      .filter((name) => name.endsWith(".test.ts"))
      .map((name) => [`tests/db/${name}`, readFileSync(new URL(name, DB_DIR), "utf8")]),
  );
}

describe("analytics fixture rows of the database tests", () => {
  it("shares none: no literal path is seeded by two files, none is read without being seeded", () => {
    expect(fixtureProblems(dbTests())).toEqual([]);
  });

  it("scans the files that insert into the analytics tables", () => {
    const seeding = Object.entries(dbTests())
      .filter(([, text]) => /insert\s+into\s+public\.analytics_/i.test(text))
      .map(([file]) => file);
    expect(seeding).toEqual(
      expect.arrayContaining([
        "tests/db/analytics.db.test.ts",
        "tests/db/audit-reads.db.test.ts",
        "tests/db/retention.db.test.ts",
        "tests/db/rls.db.test.ts",
      ]),
    );
  });

  it("refuses a path two files seed", () => {
    const sql = (path: string) =>
      "`insert into public.analytics_events (event, path) values ('page_view', '" + path + "')`";
    expect(fixtureProblems({ "a.db.test.ts": sql("/"), "b.db.test.ts": sql("/") })).toEqual([
      "/ is seeded by a.db.test.ts and b.db.test.ts",
    ]);
    expect(fixtureProblems({ "a.db.test.ts": sql("/a"), "b.db.test.ts": sql("/b") })).toEqual([]);
  });

  it("refuses a read of a literal path the file does not seed", () => {
    const text = "`select count(*) from public.analytics_events where path = '/no-such-page'`";
    expect(fixtureProblems({ "a.db.test.ts": text })).toEqual([
      "a.db.test.ts reads /no-such-page, a row it does not seed",
    ]);
  });

  it("lets a case read the literal path it seeds itself, and ignores paths built per run", () => {
    const own = [
      "`insert into public.analytics_daily (day, event, path, events) values (current_date, 'not_found', '/own', 1)`",
      "`select events from public.analytics_daily where path = '/own'`",
      "`insert into public.analytics_events (event, path) values ('page_view', $1)`",
    ].join("\n");
    // Two files that build their path per run from the same prefix share nothing.
    const built = (id: string) =>
      `\`insert into public.analytics_events (event, path) values ('page_view', '/test-' || ${id})\``;
    expect(
      fixtureProblems({
        "a.db.test.ts": own,
        "b.db.test.ts": built("v_user"),
        "c.db.test.ts": built("v_id"),
      }),
    ).toEqual([]);
  });
});
