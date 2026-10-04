create or replace function public.record_fanout_failure(p_event_id uuid, p_error text)
returns void
language sql
security definer
set search_path = ''
as $$
  -- JOB-07: the sweep waits 2, 4, 8 ... minutes before it plans the event again, at most an hour.
  insert into public.event_fanout_failures as f (event_id, attempts, next_at, last_error)
  values (p_event_id, 1, now() + least(interval '60 seconds' * 2 ^ 1, interval '1 hour'), p_error)
  on conflict (event_id) do update
  set attempts = f.attempts + 1,
    next_at = now() + least(interval '60 seconds' * 2 ^ (f.attempts + 1), interval '1 hour'),
    last_error = excluded.last_error;
$$;

revoke execute on function public.record_fanout_failure(uuid, text) from public, anon, authenticated;
grant execute on function public.record_fanout_failure(uuid, text) to service_role;
