create or replace function public.repermission_candidates(p_limit int default 200)
returns table (id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  -- GG-05: a consenting subscriber with no confirm or click for 12 months, not suppressed and not asked yet. Oldest
  -- first, so a capped run reaches the longest idle first.
  select s.id
  from public.subscribers s
  where s.confirmed_at is not null
    and s.unsubscribed_at is null
    and s.archived_at is null
    and s.repermission_sent_at is null
    and coalesce(s.last_engaged_at, s.confirmed_at) < now() - interval '12 months'
    and not exists (select 1 from public.email_suppressions x where x.email = lower(s.email))
  order by coalesce(s.last_engaged_at, s.confirmed_at)
  limit p_limit;
$$;

revoke execute on function public.repermission_candidates(int) from public, anon, authenticated;
grant execute on function public.repermission_candidates(int) to service_role;
