-- The roles and stub schemas a throwaway native PostgreSQL 18 cluster needs before `pg_restore` of the backup.yml dump
-- (public and auth of the one database, ruling H35 (1)), with no Docker (S50). Loaded by restore-rehearsal.sh into the
-- empty database before the restore. Every object here stands in for one that Supabase provides outside the dump.
-- Kept apart from pg-shims.sql (the migration drill's stand-ins): its `app.is_staff()` stub would stop the migration
-- that moves `public.is_staff()` into `app` (H1 log, "Merge of the group branches").

-- Roles are cluster-wide, so a second database on the same cluster finds them already made.
do $$
declare
  v_name text;
begin
  foreach v_name in array array['anon', 'authenticated', 'service_role', 'supabase_auth_admin', 'supabase_admin'] loop
    if not exists (select 1 from pg_roles where rolname = v_name) then
      execute format('create role %I nologin', v_name);
    end if;
  end loop;
end;
$$;

-- Schema `app` is not in the dump (backup.yml dumps public and auth); the policies of public call these two.
create schema if not exists app;
create or replace function app.is_staff() returns boolean language sql stable as 'select false';
create or replace function app.role_in(variadic anyarray) returns boolean language sql stable as 'select false';
