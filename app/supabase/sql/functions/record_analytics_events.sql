create or replace function public.record_analytics_events(p_rows jsonb)
returns int
language sql
security definer
set search_path = ''
as $$
  with stored as (
    insert into public.analytics_events (event, path, data, occurred_at)
    select r ->> 'event', r ->> 'path', coalesce(r -> 'data', '{}'::jsonb), (r ->> 'occurred_at')::timestamptz
    from jsonb_array_elements(p_rows) r
    returning 1
  )
  select count(*)::int from stored;
$$;

revoke execute on function public.record_analytics_events(jsonb) from public, anon, authenticated;
grant execute on function public.record_analytics_events(jsonb) to service_role;
