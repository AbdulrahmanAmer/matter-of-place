-- down: drop function public.newsletter_interest_counts(timestamptz, text[]);
set lock_timeout = '5s';

create or replace function public.newsletter_interest_counts(p_since timestamptz, p_pages text[])
returns table (
  market text,
  source text,
  this_week int,
  total int
)
language sql
stable
security invoker
set search_path = ''
as $$
  -- W7 item 8: the confirmed signups of the Interest screen's list (not archived, not anonymised, as
  -- newsletter_export_subscribers reads it; confirmed and not unsubscribed), counted here so no subscriber row leaves
  -- the database and no read meets PostgREST's row cap. One row per market (source ''), a signup counted once for a
  -- market however often its list names it; one row per page of p_pages (market ''), any other source counted under
  -- source '', so no word a visitor typed is returned. This week is confirmed at or after p_since.
  with confirmed as (
    select s.markets,
      case when s.source = any(p_pages) then s.source else '' end as source,
      s.confirmed_at >= p_since as this_week
    from public.subscribers s
    where s.archived_at is null
      and s.email not like '%.invalid'
      and s.confirmed_at is not null
      and s.unsubscribed_at is null
  )
  select m.market, ''::text, (count(*) filter (where c.this_week))::int, count(*)::int
  from confirmed c
  cross join lateral (select distinct unnest(c.markets) as market) m
  group by m.market
  union all
  select ''::text, c.source, (count(*) filter (where c.this_week))::int, count(*)::int
  from confirmed c
  group by c.source
  order by 1, 2;
$$;

revoke execute on function public.newsletter_interest_counts(timestamptz, text[])
  from public, anon, authenticated;
grant execute on function public.newsletter_interest_counts(timestamptz, text[]) to service_role;
