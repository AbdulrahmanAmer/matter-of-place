-- down: re-run bun run db:fn analyst_site_numbers from the previous commit of supabase/sql/functions/analyst_site_numbers.sql;
--   drop index public.email_messages_inquiry_created_idx;
set lock_timeout = '5s';

create or replace function public.analyst_site_numbers(p_to date, p_pages text[])
returns table (
  days int,
  kind text,
  label text,
  events int
)
language sql
stable
security invoker
set search_path = ''
as $$
  -- W7 item 10: the Analyst's site numbers for the 7 and the 28 UTC days before p_to, counted here so no read meets
  -- PostgREST's row cap. 'visits' sums the view events of analytics_daily (an event named *_view): the site has no
  -- page_view, so only the pages that send one count (property, market and guide, region, story, archive, and a page
  -- showing coming soon). A coming-soon market or region page sends its own view and coming_soon_view at one path, so
  -- coming_soon_view counts only at a path that sent no other view in the window (home, /properties, /stories).
  -- 'page' the ten pages with the most views, named only when the page is ours (one of p_pages, a region's page, an
  -- archive page or a published property's or story's page), so no path a visitor's beacon sent is returned; 'signup'
  -- each signup event; 'inquiries' the inquiries received, per market (the property's market, else the market of the
  -- page it was sent from, else ''), never a word of one.
  with windows (days) as (values (7), (28)),
  daily as (
    select w.days, d.event, d.path, d.events
    from windows w
    join public.analytics_daily d on d.day >= p_to - w.days and d.day < p_to
  ),
  views as (
    select v.days,
      case
        when v.path = any(p_pages) then v.path
        when v.path in (select '/' || r.market_slug || '/' || r.slug from public.regions r) then v.path
        when v.path in (select '/archive/' || f.kind || '/' || f.slug from public.archive_facets f) then v.path
        when exists (
          select 1 from public.properties p
          where p.editorial_state = 'published' and v.path = '/property/' || p.slug
        ) then v.path
        when exists (
          select 1 from public.stories s
          where s.editorial_state = 'published' and v.path = '/stories/' || s.slug
        ) then v.path
        else ''
      end as page,
      v.events
    from daily v
    where v.event like '%\_view'
      and (
        v.event <> 'coming_soon_view'
        or not exists (
          select 1 from daily o
          where o.days = v.days and o.path = v.path and o.event like '%\_view' and o.event <> 'coming_soon_view'
        )
      )
  ),
  pages as (
    select v.days, v.page, sum(v.events)::int as events,
      row_number() over (partition by v.days order by sum(v.events) desc, v.page) as rank
    from views v
    where v.page <> ''
    group by v.days, v.page
  ),
  inquiries as (
    select w.days,
      coalesce(
        (
          select p.market_slug from public.properties p
          where i.subject_kind = 'property' and p.slug = i.subject_slug
        ),
        (select m.slug from public.markets m where m.slug = split_part(i.source_path, '/', 2)),
        ''
      ) as market
    from windows w
    join public.inquiries i
      on i.received_at >= (p_to - w.days)::timestamp at time zone 'utc'
      and i.received_at < p_to::timestamp at time zone 'utc'
  )
  select w.days, 'visits'::text, ''::text, coalesce(sum(v.events), 0)::int
  from windows w
  left join views v on v.days = w.days
  group by w.days
  union all
  select p.days, 'page'::text, p.page, p.events
  from pages p
  where p.rank <= 10
  union all
  select d.days, 'signup'::text, d.event, sum(d.events)::int
  from daily d
  where d.event in ('newsletter_signup', 'interest_signup', 'newsletter_confirmed')
  group by d.days, d.event
  union all
  select i.days, 'inquiries'::text, i.market, count(*)::int
  from inquiries i
  group by i.days, i.market
  order by 1, 2, 4 desc, 3;
$$;

revoke execute on function public.analyst_site_numbers(date, text[]) from public, anon, authenticated;
grant execute on function public.analyst_site_numbers(date, text[]) to service_role;

-- W7 item 12: concierge_email_delivery reads the newest emails about inquiries in this order; the index serves it
-- without a sort of every email.
create index email_messages_inquiry_created_idx on public.email_messages (created_at desc, id desc)
where entity = 'inquiry';
