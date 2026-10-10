create or replace function public.audit_not_found(p_days int default 7, p_limit int default 20)
returns table (path text, count int, top_referrer_host text, redirected boolean)
language sql
stable
security definer
set search_path = ''
as $$
  -- B14 GG-02: the paths that answered 404, most asked first, read through analytics_events_event_occurred_idx.
  -- At most 90 days (the table's retention) and 50 paths (rule 9).
  with hits as (
    select e.path, e.data ->> 'referrer_host' as host
    from public.analytics_events e
    where e.event = 'not_found'
      and e.occurred_at >= now() - make_interval(days => least(greatest(coalesce(p_days, 7), 1), 90))
  ),
  top as (
    select h.path, count(*)::int as hits
    from hits h
    group by h.path
    order by count(*) desc, h.path
    limit least(greatest(coalesce(p_limit, 20), 1), 50)
  )
  select
    t.path,
    t.hits,
    (
      select h.host
      from hits h
      where h.path = t.path and h.host is not null
      group by h.host
      order by count(*) desc, h.host
      limit 1
    ),
    exists (select 1 from public.redirects r where r.from_path = t.path and r.archived_at is null)
      or exists (
        select 1 from public.slug_history s where s.slug = substring(t.path from '^/property/([^/]+)/?$')
      )
  from top t
  order by t.hits desc, t.path;
$$;

revoke execute on function public.audit_not_found(int, int) from public, anon, authenticated;
grant execute on function public.audit_not_found(int, int) to service_role;
