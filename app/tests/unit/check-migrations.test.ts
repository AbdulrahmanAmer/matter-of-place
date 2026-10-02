import { describe, expect, it } from "vitest";
import { checkMigrations } from "../../scripts/check-migrations.mjs";

const MAIN = ["20261001090000", "20261002100000"];
const DIR = "supabase/migrations";
const FILE = `${DIR}/20261002110000_change.sql`;
const CREATE =
  "-- down: drop table notes\nset lock_timeout = '5s';\ncreate table notes (id uuid);\n";
const DROP =
  "-- irreversible: data goes\nset lock_timeout = '5s';\nalter table notes drop column body;\n";

// Every destructive kind of STANDARDS R17 and ruling ASSUMED H42 (3), then the places a text scan
// can lose one: a DO block, a comment before it, a string that holds `--`.
const DESTRUCTIVE = [
  { name: "a drop table", kind: "drop table", sql: "drop table public.notes;" },
  { name: "a drop column", kind: "drop column", sql: "alter table notes drop column body;" },
  {
    name: "a drop written without COLUMN",
    kind: "drop column",
    sql: "alter table if exists only public.notes drop body;",
  },
  {
    name: "a rename column",
    kind: "rename",
    sql: "alter table notes rename column body to text;",
  },
  {
    name: "a rename written without COLUMN",
    kind: "rename",
    sql: "alter table notes rename body to text;",
  },
  { name: "a table rename", kind: "rename", sql: "alter table notes rename to memos;" },
  {
    name: "a column type change",
    kind: "column type",
    sql: "alter table notes alter column body type varchar(80);",
  },
  {
    name: "a type change written without COLUMN",
    kind: "column type",
    sql: "alter table notes alter body set data type varchar(80);",
  },
  {
    name: "a set not null",
    kind: "set not null",
    sql: "alter table notes alter column body set not null;",
  },
  {
    name: "a new NOT NULL column with no default",
    kind: "not null column without a default",
    sql: "alter table notes add column y text not null;",
  },
  {
    name: "a new NOT NULL column without COLUMN",
    kind: "not null column without a default",
    sql: "alter table notes add column mark text default ')', add y numeric(10, 2) not null;",
  },
  { name: "a drop view", kind: "drop view", sql: "drop view public.v_notes;" },
  {
    name: "a drop materialized view",
    kind: "drop view",
    sql: "drop materialized view public.mv_notes;",
  },
  { name: "a drop type", kind: "drop type", sql: "drop type public.note_kind;" },
  { name: "a drop function", kind: "drop function", sql: "drop function public.f(int);" },
  { name: "a drop index", kind: "drop index", sql: "drop index public.notes_body_idx;" },
  { name: "a view rename", kind: "rename", sql: "alter view v_notes rename to v_memos;" },
  {
    name: "a materialized view rename",
    kind: "rename",
    sql: "alter materialized view mv_notes rename to mv_memos;",
  },
  {
    name: "an enum value rename",
    kind: "rename",
    sql: "alter type note_kind rename value 'a' to 'b';",
  },
  { name: "a function rename", kind: "rename", sql: "alter function public.f(int) rename to g;" },
  {
    name: "a drop column inside a DO block",
    kind: "drop column",
    sql: "do $$ begin if exists (select 1) then alter table notes drop column body; end if; end $$;",
  },
  {
    name: "a drop column run by EXECUTE",
    kind: "drop column",
    sql: "do $do$ begin execute 'alter table notes drop column body'; end $do$;",
  },
  {
    name: "a DO block after a block comment",
    kind: "drop column",
    sql: "/* runs once */ do $$ begin alter table notes drop column body; end $$;",
  },
  {
    name: "a drop after a string holding two dashes",
    kind: "drop column",
    sql: "alter table notes add column mark text default 'a--b';\nalter table notes drop column body;",
  },
];

// Changes R17 leaves to an ordinary migration.
const ALLOWED = [
  {
    name: "a new NOT NULL column with a default",
    sql: "alter table notes add column y text not null default '';",
  },
  { name: "a drop trigger", sql: "drop trigger notes_touch on notes;" },
  { name: "a drop constraint", sql: "alter table notes drop constraint notes_body_check;" },
  { name: "a dropped column default", sql: "alter table notes alter column body drop default;" },
  { name: "an added check on not null", sql: "alter table notes add check (body is not null);" },
  {
    name: "a new table with NOT NULL columns",
    sql: "create table memos (id uuid not null, body text not null);",
  },
  { name: "a new serial NOT NULL column", sql: "alter table notes add column y serial not null;" },
  {
    name: "a new bigserial NOT NULL column",
    sql: "alter table notes add column y bigserial not null;",
  },
  { name: "a drop table named in a string", sql: "comment on table notes is 'drop table later';" },
  { name: "a policy rename", sql: "alter policy notes_read on notes rename to notes_select;" },
  { name: "a trigger rename", sql: "alter trigger notes_touch on notes rename to notes_stamp;" },
  { name: "an index rename", sql: "alter index notes_body_idx rename to notes_text_idx;" },
  {
    name: "a constraint rename",
    sql: "alter table notes rename constraint body_check to text_check;",
  },
  {
    name: "a function body that drops a table",
    sql: "create function f() returns void language plpgsql as $body$ begin drop table if exists notes_old; end $body$;",
  },
  {
    name: "a drop inside a nested block comment",
    sql: "/* a /* b */ drop table notes; */ create table memos (id uuid);",
  },
  {
    name: "a drop inside an escape string",
    sql: "comment on table notes is E'it\\'s; drop table notes';",
  },
];

function run(added: Record<string, string>, changed: string[] = []) {
  return checkMigrations({
    changed,
    added: Object.keys(added),
    mainPrefixes: MAIN,
    readFile: (path) => added[path] ?? "",
  });
}

function migration(sql: string) {
  return `-- irreversible: data goes\nset lock_timeout = '5s';\n${sql}\n`;
}

describe("checkMigrations", () => {
  it("passes a clean tree and a new file after the newest on main", () => {
    expect([run({}), run({ [`${DIR}/20261002110000_notes.sql`]: CREATE })]).toEqual([[], []]);
  });

  it("refuses an edited applied migration", () => {
    expect(run({}, [`${DIR}/20261001090000_extensions_enums.sql`])).toEqual([
      `applied migration changed: ${DIR}/20261001090000_extensions_enums.sql`,
    ]);
  });

  it("refuses an added file with an older timestamp than main", () => {
    expect(run({ [`${DIR}/20261001095900_notes.sql`]: CREATE })).toEqual([
      `rename ${DIR}/20261001095900_notes.sql to a timestamp after 20261002100000`,
    ]);
  });

  it.each(DESTRUCTIVE)("$name needs the contract-of header", ({ kind, sql }) => {
    expect(run({ [FILE]: migration(sql) })).toEqual([
      `destructive change (${kind}) without "-- contract-of: <14-digit version>" in its first 30 lines: ${FILE}`,
    ]);
  });

  it.each(ALLOWED)("$name needs no contract-of header", ({ sql }) => {
    expect(run({ [FILE]: migration(sql) })).toEqual([]);
  });

  it("accepts a drop column with the contract-of header in its first 30 lines", () => {
    const contract = `-- contract-of: 20261001090000\n${DROP}`;
    expect(run({ [`${DIR}/20261002110000_drop_body.sql`]: contract })).toEqual([]);
  });

  it("refuses a contract-of header without a 14-digit version", () => {
    const short = `-- contract-of: 202610\n${DROP}`;
    expect(run({ [`${DIR}/20261002110000_drop_body.sql`]: short })).toHaveLength(1);
  });

  it("refuses a contract-of header below line 30", () => {
    const late = `${DROP}${"--\n".repeat(30)}-- contract-of: 20261001090000\n`;
    expect(run({ [`${DIR}/20261002110000_drop_body.sql`]: late })).toHaveLength(1);
  });
});
