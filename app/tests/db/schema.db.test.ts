// The schema against tests/db/schema-manifest.ts, the column shape rules of STANDARDS R20 and R24, and the
// personal-data list of invariant 18 (DB-03). Each assertion names its offenders.
import { describe, expect, it } from "vitest";
import { withRollback } from "../fixtures/db";
import { moneyColumns, notPii, schemaManifest } from "./schema-manifest";

async function rows<T extends object>(sql: string): Promise<T[]> {
  return withRollback(async (db) => (await db.query<T>(sql)).rows);
}

// The manifest's spelling of a column type; `?` marks a nullable column.
const COLUMNS = `
  select table_name, column_name,
    case
      when data_type = 'USER-DEFINED' then udt_name
      when data_type = 'ARRAY' then substr(udt_name, 2) || '[]'
      when data_type = 'numeric' then format('numeric(%s,%s)', numeric_precision, numeric_scale)
      when data_type = 'character' then format('char(%s)', character_maximum_length)
      when data_type = 'timestamp with time zone' then 'timestamptz'
      else data_type
    end || case when is_nullable = 'YES' then '?' else '' end as spec
  from information_schema.columns
  where table_schema = 'public'`;

describe("manifest", () => {
  // A monthly partition of analytics_events is a table too; its parent holds the manifest entry.
  it("every public table has a manifest entry", async () => {
    const tables = await rows<{ table_name: string }>(`
      select t.table_name
      from information_schema.tables t
      where t.table_schema = 'public'
        and t.table_type = 'BASE TABLE'
        and not exists (
          select 1 from pg_class c
          where c.relnamespace = 'public'::regnamespace and c.relname = t.table_name and c.relispartition
        )`);
    const missing = tables.map((t) => t.table_name).filter((name) => !(name in schemaManifest));
    expect(missing).toEqual([]);
  });

  it.each(Object.keys(schemaManifest))("%s columns match the manifest", async (table) => {
    const live = await rows<{ table_name: string; column_name: string; spec: string }>(COLUMNS);
    const columns = Object.fromEntries(
      live.filter((c) => c.table_name === table).map((c) => [c.column_name, c.spec]),
    );
    expect(columns).toEqual(schemaManifest[table]);
  });
});

describe("shape", () => {
  it("no zone-less time, float, money type or sequence default (R24)", async () => {
    const offenders = await rows<{ name: string; reason: string }>(`
      select table_name || '.' || column_name as name,
        case when column_default like 'nextval(%' then 'nextval' else data_type end as reason
      from information_schema.columns
      where table_schema = 'public'
        and (data_type in ('timestamp without time zone', 'real', 'double precision', 'money')
          or column_default like 'nextval(%')
      order by 1`);
    expect(offenders).toEqual([]);
  });

  it("every money column is numeric(12,2) (R24)", async () => {
    const live = await rows<{ name: string; spec: string }>(`
      select table_name || '.' || column_name as name,
        format('%s(%s,%s)', data_type, numeric_precision, numeric_scale) as spec
      from information_schema.columns
      where table_schema = 'public'`);
    const specs = new Map(live.map((c) => [c.name, c.spec]));
    const offenders = moneyColumns.filter((name) => specs.get(name) !== "numeric(12,2)");
    expect(offenders).toEqual([]);
  });

  it("every foreign key states on delete and leads an index (R24)", async () => {
    const offenders = await rows<{ name: string; reason: string }>(`
      select c.conrelid::regclass::text || '.' || c.conname as name,
        case when c.confdeltype not in ('c', 'n', 'r') then 'on delete ' || c.confdeltype::text else 'no index' end
          as reason
      from pg_constraint c
      where c.contype = 'f'
        and c.connamespace = 'public'::regnamespace
        and (c.confdeltype not in ('c', 'n', 'r')
          or not exists (
            select 1 from pg_index i where i.indrelid = c.conrelid and i.indkey[0] = c.conkey[1]
          ))
      order by 1`);
    expect(offenders).toEqual([]);
  });

  it("every view is security_invoker (R20)", async () => {
    const offenders = await rows<{ name: string }>(`
      select c.relname as name
      from pg_class c
      where c.relnamespace = 'public'::regnamespace
        and c.relkind = 'v'
        and not coalesce('security_invoker=true' = any (c.reloptions), false)
      order by 1`);
    expect(offenders).toEqual([]);
  });
});

describe("pii_columns", () => {
  it("every personal-data column has a pii_columns row or a notPii entry", async () => {
    const offenders = await rows<{ name: string }>(`
      select c.table_name || '.' || c.column_name as name
      from information_schema.columns c
      where c.table_schema = 'public'
        and c.column_name ~ '(email|phone|name|address|message|location)'
        and not exists (
          select 1 from public.pii_columns p
          where p.table_name = c.table_name and p.column_name = c.column_name
        )
      order by 1`);
    const unlisted = offenders.map((o) => o.name).filter((name) => !notPii.includes(name));
    expect(unlisted).toEqual([]);
  });

  it("representatives.email and representatives.phone have rows", async () => {
    const listed = await rows<{ name: string }>(`
      select table_name || '.' || column_name as name
      from public.pii_columns
      where table_name = 'representatives' and column_name in ('email', 'phone')
      order by 1`);
    expect(listed.map((r) => r.name)).toEqual(["representatives.email", "representatives.phone"]);
  });

  // Invariant 18: the fifteen columns migration 5 creates that hold personal data.
  it("the intake tables list their fifteen personal-data columns", async () => {
    const listed = await rows<{ name: string }>(`
      select table_name || '.' || column_name as name
      from public.pii_columns
      where table_name in ('submissions', 'contacts', 'inquiries', 'subscribers')
      order by 1`);
    expect(listed.map((r) => r.name)).toEqual([
      "contacts.email",
      "contacts.name",
      "contacts.notes",
      "contacts.phone",
      "inquiries.email",
      "inquiries.location",
      "inquiries.message",
      "inquiries.name",
      "inquiries.phone",
      "submissions.address",
      "submissions.listing_agent_name",
      "submissions.submitter_email",
      "submissions.submitter_name",
      "submissions.submitter_phone",
      "subscribers.email",
    ]);
  });
});
