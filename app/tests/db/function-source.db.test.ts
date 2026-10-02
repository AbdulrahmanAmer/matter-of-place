// DB-13, STANDARDS R19: supabase/sql/functions/<name>.sql holds the one current text of every function in `public`.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { withRollback } from "../fixtures/db";

const FUNCTIONS = new URL("../../supabase/sql/functions/", import.meta.url);
const DOLLAR_BODY = /\$([A-Za-z_]*)\$([\s\S]*?)\$\1\$/;

const sources = new Map(
  readdirSync(FUNCTIONS)
    .filter((file) => file.endsWith(".sql"))
    .map((file) => {
      const body = DOLLAR_BODY.exec(readFileSync(new URL(file, FUNCTIONS), "utf8"))?.[2];
      return [file.slice(0, -".sql".length), body?.trim()] as const;
    }),
);

// Supabase's own rls_auto_enable and extension-owned functions (pg_depend deptype e) have no file.
const PUBLIC_FUNCTIONS = `
  select p.proname as name, p.prosrc as body
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and p.proname <> 'rls_auto_enable'
    and not exists (
      select 1 from pg_depend d
      where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'
    )`;

describe("function source", () => {
  it("every function file's body equals pg_proc.prosrc, and every public function has a file", async () => {
    const live = await withRollback(
      async (db) => (await db.query<{ name: string; body: string }>(PUBLIC_FUNCTIONS)).rows,
    );
    const liveBodies = new Map(live.map(({ name, body }) => [name, body.trim()]));
    const differs = [...sources]
      .filter(([name, body]) => body === undefined || liveBodies.get(name) !== body)
      .map(([name]) => name);
    const withoutFile = live.filter(({ name }) => !sources.has(name)).map(({ name }) => name);
    expect({ differs, withoutFile }).toEqual({ differs: [], withoutFile: [] });
  });
});
