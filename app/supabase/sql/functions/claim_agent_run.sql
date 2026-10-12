create or replace function public.claim_agent_run(p_worker text, p_lease_seconds integer default 900)
returns setof public.agent_runs
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  update public.agent_runs r
  set state = 'running',
      worker = p_worker,
      lease_until = now() + make_interval(secs => p_lease_seconds),
      started_at = coalesce(r.started_at, now())
  where r.id = (
    select c.id
    from public.agent_runs c
    join public.agents a on a.id = c.agent_id
    left join public.agent_messages m on m.id = c.message_id
    where a.state in ('idle', 'working')
      and (c.state = 'queued' or (c.state = 'running' and c.lease_until < now()))
    -- Gap audit item 3 (Jay M5): a person's own message first, then mentions between colleagues and events, then the
    -- scheduled backlog; oldest first within each.
    order by
      case
        when c.cause = 'message' and m.author_kind = 'human' then 0
        when c.cause in ('message', 'event') then 1
        else 2
      end,
      c.created_at
    limit 1
    for update of c skip locked
  )
  returning r.*;
end;
$$;

revoke all on function public.claim_agent_run(text, integer) from public, anon, authenticated;
grant execute on function public.claim_agent_run(text, integer) to service_role;
