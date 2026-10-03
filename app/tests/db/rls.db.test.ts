// STANDARDS R20 and architecture 3.7: migration 10 against rls-matrix.ts. Every table in `public` has RLS on, the
// table and function privileges equal the matrix, and each role does exactly what its matrix row allows.
import { describe, expect, it } from "vitest";
import { createAuthUser, createStaffUser, withRollback, type Db } from "../fixtures/db";
import {
  allows,
  authenticatedFunctions,
  rlsMatrix,
  staffRoles,
  tableOperations,
  type StaffRole,
  type TableOperation,
} from "./rls-matrix";

const PUBLIC_TABLES = `
  select c.relname as name, c.relispartition as partition
  from pg_class c
  where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
  order by c.relname`;

async function publicTables(db: Db): Promise<{ name: string; partition: boolean }[]> {
  return (await db.query<{ name: string; partition: boolean }>(PUBLIC_TABLES)).rows;
}

const sorted = (names: Iterable<string>) => [...names].sort();

// One row in every table, written as postgres inside the test's transaction.
const FIXTURES = `do $$
declare
  v_user uuid := current_setting('mop.rls_user')::uuid;
  v_property uuid;
  v_submission uuid;
  v_payment uuid;
  v_campaign uuid;
begin
  insert into public.migration_checksums (version, sha256) values ('00000000000000', 'test')
  on conflict do nothing;
  insert into public.agent_keys (user_id, key_hash, label) values (v_user, 'test-rls-' || v_user, 'Test key');
  insert into public.audit_log (action, entity) values ('test.rls', 'test');
  insert into public.markets (slug, name, country, intro) values ('california', 'California', 'United States', 'x')
  on conflict (slug) do nothing;
  insert into public.regions (slug, market_slug, name, intro) values ('test-rls-region', 'california', 'Test', 'x');
  insert into public.market_notes (market_slug, label, text) values ('california', 'Test', 'x');
  insert into public.market_guide_entries (market_slug, section, label, text)
  values ('california', 'need', 'Test', 'x');
  insert into public.representatives (name, brokerage) values ('Test Person', 'Test Brokerage');
  insert into public.properties (slug, title, market_slug, city, state, address, type)
  values ('test-rls-house', 'Test house', 'california', 'Berkeley', 'CA', '1 Test Way', 'Residence')
  returning id into v_property;
  insert into public.property_media (property_id, staging_path) values (v_property, 'staging/test/a.jpg');
  insert into public.property_features (property_id, feature) values (v_property, 'Test');
  insert into public.property_related (property_id, related_slug) values (v_property, 'test-rls-other');
  insert into public.stories (slug, title, deck, category, market_slug)
  values ('test-rls-story', 'Test story', 'x', 'Places', 'california');
  insert into public.settings (key, value) values ('test_rls', '{}');
  insert into public.slug_history (slug, property_id) values ('test-rls-old', v_property);
  insert into public.redirects (from_path, to_path) values ('/test-rls-from', '/test-rls-to');
  insert into public.retention_policies (key, table_name, action) values ('test_rls', 'inquiries', 'keep');
  insert into public.contacts (kind, name, email) values ('owner', 'Test Person', 'test-rls-' || v_user || '@example.test');
  insert into public.decline_reasons (code, label, email_paragraph) values ('test_rls', 'Test', 'x');
  insert into public.submissions (
    address, city, state, zip, property_type, submitter_kind, submitter_name, submitter_email, story, significance,
    package, source_path, rights_version, rights_confirmed_at, rights_ip_hash
  ) values (
    '1 Test Way', 'Berkeley', 'California', '94702', 'Residence', 'owner', 'Test Person', 'person@example.test',
    'x', 'x', 'The Feature', '/submit', 'test-v1', now(), 'test-hash'
  ) returning id into v_submission;
  insert into public.submission_media (submission_id, name, storage_path) values (v_submission, 'a.jpg', 'test/a.jpg');
  insert into public.inquiries (intent, name, email, message, source_path)
  values ('ask', 'Test Person', 'person@example.test', 'x', '/contact');
  insert into public.subscribers (email, source) values ('test-rls-' || v_user || '@example.test', 'test');
  insert into public.analytics_events (event, path, occurred_at) values ('page_view', '/', now());
  insert into public.payments (submission_id, product, amount) values (v_submission, 'The Feature', 1000)
  returning id into v_payment;
  insert into public.campaigns (property_id, payment_id, package) values (v_property, v_payment, 'The Feature')
  returning id into v_campaign;
  insert into public.campaign_reports (campaign_id, period_start, period_end)
  values (v_campaign, current_date, current_date);
  insert into public.rate_limits (bucket, key_hash) values ('test-rls', 'test-rls-' || v_user);
  insert into public.webhook_receipts (provider, id) values ('test-rls', 'test-rls-' || v_user);
  insert into public.subject_requests (email, kind) values ('test-rls-' || v_user || '@example.test', 'access');
end
$$`;

// Runs one operation on one row of the table as the role, then rolls it back, and answers `rows <n>` or the error's
// SQLSTATE. An insert writes a copy of that row, so a refused one fails the policy (42501) before the copy's
// duplicate key (23505); update sets a key column to itself; select and delete name the row by its ctid. The row is
// one the fixtures wrote in this transaction (xmin), so seeded rows never change the outcome (R52); a table the
// fixtures skipped (a conflict) falls back to any row.
const PROBE = `create function pg_temp.rls_probe(p_table regclass, p_op text, p_role text, p_user uuid)
returns text
language plpgsql
as $$
declare
  v_oid oid;
  v_ctid tid;
  v_row jsonb;
  v_columns text;
  v_key text;
  v_where text;
  v_rows bigint;
begin
  execute format(
    'select tableoid, ctid, to_jsonb(t) from %s t order by t.xmin::text = pg_current_xact_id()::xid::text desc limit 1',
    p_table
  ) into v_oid, v_ctid, v_row;
  v_where := case when v_oid is null then 'false' else format('tableoid = %s and ctid = %L', v_oid, v_ctid) end;
  select string_agg(quote_ident(a.attname), ', ' order by a.attnum) into v_columns
  from pg_attribute a
  where a.attrelid = p_table and a.attnum > 0 and not a.attisdropped and a.attgenerated = '' and a.attidentity <> 'a';
  select quote_ident(a.attname) into v_key
  from pg_attribute a
  left join pg_index i on i.indrelid = a.attrelid and i.indisprimary and a.attnum = any (i.indkey)
  where a.attrelid = p_table and a.attnum > 0 and not a.attisdropped and a.attgenerated = '' and a.attidentity = ''
  order by i.indrelid is null, a.attnum
  limit 1;
  begin
    if p_user is not null then
      perform set_config('request.jwt.claims', json_build_object('sub', p_user)::text, true);
    end if;
    execute format('set local role %I', p_role);
    execute case p_op
      when 'select' then format('select 1 from %s where %s', p_table, v_where)
      when 'insert' then format(
        'insert into %s (%s) select %2$s from jsonb_populate_record(null::%1$s, %3$L)', p_table, v_columns, v_row
      )
      when 'update' then format('update %s set %s = %2$s where %s', p_table, v_key, v_where)
      when 'delete' then format('delete from %s where %s', p_table, v_where)
    end;
    get diagnostics v_rows = row_count;
    raise exception using errcode = 'MOP01', message = v_rows::text;
  exception
    when sqlstate 'MOP01' then
      return 'rows ' || sqlerrm;
    when others then
      return sqlstate;
  end;
end
$$`;

type Verdict = "allowed" | "refused";

function verdict(op: TableOperation, outcome: string): string {
  if (outcome === "rows 1" || (op === "insert" && outcome === "23505")) return "allowed";
  if (outcome === "rows 0" || outcome === "42501") return "refused";
  return outcome;
}

interface Probe {
  label: string;
  role: "anon" | "authenticated";
  roles: StaffRole[] | null;
}

const probes: Probe[] = [
  ...staffRoles.map((role): Probe => ({ label: role, role: "authenticated", roles: [role] })),
  { label: "admin plus chief_editor", role: "authenticated", roles: ["admin", "chief_editor"] },
  { label: "a signed-in user with no role", role: "authenticated", roles: [] },
  { label: "anon", role: "anon", roles: null },
];

interface Outcome {
  name: string;
  op: TableOperation;
  outcome: string;
}

async function observe(db: Db, probe: Probe): Promise<Outcome[]> {
  const owner = await createAuthUser(db);
  await db.query("select set_config('mop.rls_user', $1, true)", [owner]);
  await db.query(FIXTURES);
  await db.query(PROBE);
  const user = probe.roles === null ? null : await createStaffUser(db, probe.roles);
  const tables = (await publicTables(db)).map(({ name }) => name);
  const result = await db.query<Outcome>(
    `select t.name, o.op, pg_temp.rls_probe(format('public.%I', t.name)::regclass, o.op, $1, $2) as outcome
     from unnest($3::text[]) as t (name) cross join unnest($4::text[]) as o (op)`,
    [probe.role, user, tables, tableOperations],
  );
  return result.rows;
}

describe("the matrix", () => {
  it("names every app_role and every table in public", async () => {
    const { roles, tables } = await withRollback(async (db) => ({
      roles: (
        await db.query<{ role: string }>(
          "select unnest(enum_range(null::public.app_role))::text as role order by 1",
        )
      ).rows.map(({ role }) => role),
      tables: (await publicTables(db))
        .filter(({ partition }) => !partition)
        .map(({ name }) => name),
    }));
    expect({ roles, tables }).toEqual({
      roles: sorted(staffRoles),
      tables: sorted(Object.keys(rlsMatrix)),
    });
  });

  it("every table in public has row level security on", async () => {
    const offenders = await withRollback(
      async (db) =>
        (
          await db.query<{ relname: string }>(
            `select relname from pg_class
             where relnamespace = 'public'::regnamespace and relkind in ('r', 'p') and not relrowsecurity
             order by relname`,
          )
        ).rows,
    );
    expect(offenders.map(({ relname }) => relname)).toEqual([]);
  });
});

describe("privileges", () => {
  it("authenticated holds exactly the matrix's table privileges", async () => {
    const held = await withRollback(
      async (db) =>
        (
          await db.query<{ name: string; privileges: string[] }>(
            `select c.relname as name,
               array(
                 select p from unnest(array['select', 'insert', 'update', 'delete', 'truncate', 'references',
                   'trigger']) as p
                 where has_table_privilege('authenticated', c.oid, p)
               ) as privileges
             from pg_class c
             where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
             order by c.relname`,
          )
        ).rows,
    );
    const observed = held.map(({ name, privileges }) => `${name}: ${privileges.join(" ")}`);
    const expected = held.map(
      ({ name }) =>
        `${name}: ${tableOperations.filter((op) => allows(name, op, staffRoles)).join(" ")}`,
    );
    expect(observed).toEqual(expected);
  });

  it("anon holds no table privilege and service_role selects every table", async () => {
    const rows = await withRollback(
      async (db) =>
        (
          await db.query<{ name: string; anon: boolean; service: boolean }>(
            `select c.relname as name,
               has_table_privilege('anon', c.oid, 'select, insert, update, delete, truncate, references, trigger')
                 as anon,
               has_table_privilege('service_role', c.oid, 'select') as service
             from pg_class c
             where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')`,
          )
        ).rows,
    );
    expect({
      anon: rows.filter(({ anon }) => anon).map(({ name }) => name),
      serviceRoleCannotSelect: rows.filter(({ service }) => !service).map(({ name }) => name),
    }).toEqual({ anon: [], serviceRoleCannotSelect: [] });
  });

  it("anon executes no function in public or app and authenticated only the allow-list", async () => {
    const rows = await withRollback(
      async (db) =>
        (
          await db.query<{ name: string; anon: boolean; authenticated: boolean }>(
            `select p.pronamespace::regnamespace::text || '.' || p.proname as name,
               has_function_privilege('anon', p.oid, 'execute') as anon,
               has_function_privilege('authenticated', p.oid, 'execute') as authenticated
             from pg_proc p
             where p.pronamespace in ('public'::regnamespace, 'app'::regnamespace)
             order by name`,
          )
        ).rows,
    );
    expect({
      anon: rows.filter(({ anon }) => anon).map(({ name }) => name),
      authenticated: rows.filter(({ authenticated }) => authenticated).map(({ name }) => name),
    }).toEqual({ anon: [], authenticated: sorted(authenticatedFunctions) });
  });
});

describe("the matrix as behaviour", () => {
  it.each(probes)("as $label, every table and operation matches the matrix", async (probe) => {
    const outcomes = await withRollback((db) => observe(db, probe));
    const roles = probe.roles ?? [];
    const observed = outcomes.map(
      ({ name, op, outcome }) => `${name} ${op}: ${verdict(op, outcome)}`,
    );
    const expected = outcomes.map(({ name, op }) => {
      const answer: Verdict = allows(name, op, roles) ? "allowed" : "refused";
      return `${name} ${op}: ${answer}`;
    });
    expect(observed).toEqual(expected);
  });
});
