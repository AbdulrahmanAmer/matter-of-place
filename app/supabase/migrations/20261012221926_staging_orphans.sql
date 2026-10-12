-- down: re-run bun run db:fn staging_orphans from the previous commit of supabase/sql/functions/staging_orphans.sql
set lock_timeout = '5s';

create or replace function public.staging_orphans(p_older interval, p_limit integer default 500)
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  -- Gap audit item 18 (operator's yes, 2026-10-13): an upload staged in the private bucket and never attached. A file
  -- older than p_older is an orphan only when no photograph row names it and no unfinished job mentions it.
  select o.name
  from storage.objects o
  where o.bucket_id = 'submissions'
    and o.name like 'staging/%'
    and o.created_at < now() - p_older
    and not exists (select 1 from public.property_media m where m.staging_path = o.name)
    and not exists (
      select 1 from public.jobs j
      where j.status not in ('done', 'dead', 'cancelled')
        and strpos(j.payload::text, o.name) > 0
    )
  order by o.created_at
  limit greatest(least(p_limit, 1000), 1);
$$;

revoke execute on function public.staging_orphans(interval, integer) from public, anon, authenticated;
grant execute on function public.staging_orphans(interval, integer) to service_role;
