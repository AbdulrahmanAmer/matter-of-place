create or replace function public.queue_event_runs(p_agents uuid[], p_events uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_queued integer;
begin
  -- W8 0h fourth review: the one way the laptop runner queues a run on an event (the daemon's wake, the hand-off of a
  -- property to the Editor). The index that keeps one run per (agent, event) is partial, so the conflict names its
  -- predicate: without it Postgres refuses the insert (42P10) and nothing is queued. Pairs by position; returns how
  -- many runs are new, so a pair already queued counts 0 and is not an error.
  if p_agents is null or p_events is null or cardinality(p_agents) <> cardinality(p_events)
    or cardinality(p_agents) > 1000
  then
    raise exception 'bad_request';
  end if;
  insert into public.agent_runs (agent_id, cause, event_id)
  select pair.agent_id, 'event', pair.event_id
  from unnest(p_agents, p_events) as pair (agent_id, event_id)
  where pair.agent_id is not null and pair.event_id is not null
  on conflict (agent_id, event_id) where event_id is not null do nothing;
  get diagnostics v_queued = row_count;
  return v_queued;
end;
$$;

revoke execute on function public.queue_event_runs(uuid[], uuid[]) from public, anon, authenticated;
grant execute on function public.queue_event_runs(uuid[], uuid[]) to service_role;
