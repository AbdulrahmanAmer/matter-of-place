create or replace function public.claim_matter_live(p_worker text, p_lease_seconds integer default 3000)
returns setof public.agent_runs
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- W5: Matter's live session takes a person's lines to Matter, oldest first, one at a time. Only a person's line:
  -- events, system lines and colleagues' lines stay one-shot, read-only runs (ruling H101).
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
    join public.agent_messages m on m.id = c.message_id
    where a.slug = 'matter'
      and a.state in ('idle', 'working')
      and c.cause = 'message'
      and m.author_kind = 'human'
      and (c.state = 'queued' or (c.state = 'running' and c.lease_until < now()))
    order by c.created_at
    limit 1
    for update of c skip locked
  )
  returning r.*;
end;
$$;

revoke all on function public.claim_matter_live(text, integer) from public, anon, authenticated;
grant execute on function public.claim_matter_live(text, integer) to service_role;
