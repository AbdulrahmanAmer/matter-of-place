create or replace function public.claim_agent_run(
  p_worker text,
  p_lease_seconds integer default 900,
  p_skip_live boolean default false
)
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
      -- W5 (operator, 2026-10-13: "make him full"): while Matter's live session runs, a person's line to Matter is
      -- its work (claim_matter_live), never a one-shot run's.
      and not (p_skip_live and a.slug = 'matter' and c.cause = 'message' and m.author_kind = 'human')
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

revoke all on function public.claim_agent_run(text, integer, boolean) from public, anon, authenticated;
grant execute on function public.claim_agent_run(text, integer, boolean) to service_role;
