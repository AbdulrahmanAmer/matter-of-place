create or replace function public.rollup_analytics_daily(p_from date, p_to date)
returns int
language sql
security definer
set search_path = ''
as $$
  -- Ruling H16: the daily aggregates of the raw events from p_from to p_to, UTC days. A rerun recomputes the same
  -- numbers from the raw rows and never counts them twice; a day whose raw rows are gone writes nothing and keeps its
  -- aggregate. p75 is the 75th percentile of a web vital's value, null for every other event.
  with written as (
    insert into public.analytics_daily (day, event, path, dim, events, p75)
    select (occurred_at at time zone 'utc')::date,
      event,
      path,
      case event
        when 'web_vitals' then coalesce(data ->> 'name', '')
        when 'csp_report' then coalesce(data ->> 'directive', '')
        else ''
      end,
      count(*),
      (percentile_cont(0.75) within group (
        order by case when data ->> 'value' ~ '^-?[0-9]+(\.[0-9]+)?$' then (data ->> 'value')::numeric end
      ) filter (where event = 'web_vitals'))::numeric
    from public.analytics_events
    where occurred_at >= p_from::timestamp at time zone 'utc'
      and occurred_at < (p_to + 1)::timestamp at time zone 'utc'
    group by 1, 2, 3, 4
    on conflict (day, event, path, dim) do update set events = excluded.events, p75 = excluded.p75
    returning 1
  )
  select count(*)::int from written;
$$;

revoke execute on function public.rollup_analytics_daily(date, date) from public, anon, authenticated;
grant execute on function public.rollup_analytics_daily(date, date) to service_role;
