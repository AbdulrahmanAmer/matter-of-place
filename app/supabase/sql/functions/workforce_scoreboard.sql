create or replace function public.workforce_scoreboard(p_since timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  -- W2 step 6: the daily scoreboard ("if they do not move, nothing improved"): per colleague since p_since, the runs,
  -- the failed ones, the time to answer, the cost from our own price table, and the approval outcomes, whose
  -- approved-as-is share is the main number. Read by the Office screen through the admin API.
  select coalesce(jsonb_agg(row_to_json(s) order by s.name), '[]'::jsonb)
  from (
    select
      a.slug,
      a.name,
      (select count(*) from public.agent_runs r where r.agent_id = a.id and r.created_at >= p_since) as runs,
      (select count(*) from public.agent_runs r
        where r.agent_id = a.id and r.created_at >= p_since and r.state = 'failed') as failed,
      (select round(avg(extract(epoch from r.finished_at - r.created_at)))::integer
        from public.agent_runs r
        where r.agent_id = a.id and r.created_at >= p_since and r.state = 'done') as answer_seconds,
      (select coalesce(sum(r.cost_microusd), 0) from public.agent_runs r
        where r.agent_id = a.id and r.created_at >= p_since) as cost_microusd,
      (select count(*) from public.agent_approvals p
        where p.agent_id = a.id and p.decided_at >= p_since and p.state in ('approved', 'rejected')) as decided,
      (select count(*) from public.agent_approvals p
        where p.agent_id = a.id and p.decided_at >= p_since and p.state = 'approved'
          and p.edited_content is null) as as_is,
      (select count(*) from public.agent_approvals p
        where p.agent_id = a.id and p.decided_at >= p_since and p.state = 'approved'
          and p.edited_content is not null) as edited,
      (select count(*) from public.agent_approvals p
        where p.agent_id = a.id and p.decided_at >= p_since and p.state = 'rejected') as declined,
      (select count(*) from public.agent_lessons l where l.agent_id = a.id and l.status = 'active') as lessons
    from public.agents a
    where a.state <> 'off'
  ) s;
$$;

revoke execute on function public.workforce_scoreboard(timestamptz) from public, anon, authenticated;
grant execute on function public.workforce_scoreboard(timestamptz) to service_role;
