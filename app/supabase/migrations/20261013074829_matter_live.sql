-- down: re-run bun run db:fn claim_agent_run claim_matter_live from the previous commit of supabase/sql/functions/claim_agent_run.sql, supabase/sql/functions/claim_matter_live.sql
set lock_timeout = '5s';

drop function if exists public.claim_agent_run(p_worker text, p_lease_seconds integer);

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
