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
    where a.state in ('idle', 'working')
      and (c.state = 'queued' or (c.state = 'running' and c.lease_until < now()))
    order by c.created_at
    limit 1
    for update of c skip locked
  )
  returning r.*;
end;
$$;

revoke all on function public.claim_agent_run(text, integer) from public, anon, authenticated;
grant execute on function public.claim_agent_run(text, integer) to service_role;
