create or replace function public.fanout_pending_events(p_limit int)
returns setof public.events
language sql
stable
security definer
set search_path = ''
as $$
  -- JOB-07: the one read of the sweep; an event that failed waits for its next_at.
  select e.*
  from public.events e
  where e.processed_at is null
    and not exists (
      select 1 from public.event_fanout_failures f where f.event_id = e.id and f.next_at > now()
    )
  order by e.at
  limit p_limit;
$$;

revoke execute on function public.fanout_pending_events(int) from public, anon, authenticated;
grant execute on function public.fanout_pending_events(int) to service_role;
