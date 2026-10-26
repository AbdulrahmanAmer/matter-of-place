-- down: re-run bun run db:fn record_build_lesson from the previous commit of supabase/sql/functions/record_build_lesson.sql
set lock_timeout = '5s';

create or replace function public.record_build_lesson(
  p_agent uuid,
  p_pr integer,
  p_trigger text,
  p_action text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted integer;
begin
  -- W6 item 4: the lesson of one merged pull request of Matter's, written by the laptop runner. One row per pull
  -- request (the unique index agent_lessons_build_pr): a merge read twice writes once. True when this call wrote it.
  if p_pr is null or p_pr < 1 then
    raise exception 'validation' using errcode = '22023', detail = 'A build lesson needs a pull request number.';
  end if;
  if not exists (select 1 from public.agents a where a.id = p_agent) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  insert into public.agent_lessons (agent_id, trigger, action, evidence_ref, source)
  values (p_agent, p_trigger, p_action, 'pr:' || p_pr::text, 'build')
  on conflict (evidence_ref) where source = 'build' do nothing;
  get diagnostics v_inserted = row_count;
  return v_inserted = 1;
end;
$$;

revoke execute on function public.record_build_lesson(uuid, integer, text, text) from public, anon, authenticated;
grant execute on function public.record_build_lesson(uuid, integer, text, text) to service_role;
