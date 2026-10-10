-- H1 step 3: what the RLS review reads from the catalog of the one database, as one JSON row. Every relation in
-- `public` with its row level security flags and the table privileges `anon` and `authenticated` hold on it, every
-- policy in `public`, and every function in `public` and `app` (the schemas the migrations own) with its security
-- definer flag, its fixed `search_path` and whether `anon` or `authenticated` may execute it.
-- `bun run scripts/harden/rls-review.ts --env dev` judges it; `bun run db:psql -- -Atf scripts/harden/rls-review.sql`
-- prints it.
select jsonb_build_object(
  'tables', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'name', c.relname,
      'kind', c.relkind::text,
      'partition', c.relispartition,
      'rls', c.relrowsecurity,
      'force', c.relforcerowsecurity,
      'anon', array(
        select p from unnest(array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']) as p
        where has_table_privilege('anon', c.oid, p)
      ),
      'authenticated', array(
        select p from unnest(array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']) as p
        where has_table_privilege('authenticated', c.oid, p)
      )
    ) order by c.relname), '[]'::jsonb)
    from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f')
  ),
  'policies', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'table', p.tablename,
      'name', p.policyname,
      'permissive', p.permissive = 'PERMISSIVE',
      'roles', p.roles,
      'command', p.cmd,
      'expression', concat_ws(' ', p.qual, p.with_check)
    ) order by p.tablename, p.policyname), '[]'::jsonb)
    from pg_policies p
    where p.schemaname = 'public'
  ),
  'functions', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'name', n.nspname || '.' || f.proname || '(' || pg_get_function_identity_arguments(f.oid) || ')',
      'definer', f.prosecdef,
      'searchPath', (select s from unnest(f.proconfig) as s where s like 'search_path=%' limit 1),
      'anon', has_function_privilege('anon', f.oid, 'execute'),
      'authenticated', has_function_privilege('authenticated', f.oid, 'execute')
    ) order by n.nspname, f.proname, f.oid), '[]'::jsonb)
    from pg_proc f
    join pg_namespace n on n.oid = f.pronamespace
    where n.nspname in ('public', 'app')
  )
) as review;
