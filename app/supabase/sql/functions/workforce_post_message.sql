create or replace function public.workforce_post_message(
  p_thread text,
  p_body text,
  p_author_id text,
  p_author_name text,
  p_wake text[],
  p_author_kind text default 'agent'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  -- W1: a line in the team chat or a direct thread, and the runs it wakes. Who wakes is decided by the caller
  -- (`wakeTargets` in src/domain/workforce.ts); a colleague who is off is skipped here as well.
  -- H101: only the caller's signed-in person writes 'human'; an agent key's line is 'agent' (the default), so it never
  -- gives Matter full power or a person's priority.
  if p_author_kind not in ('human', 'agent') then
    raise exception 'invalid_author_kind';
  end if;
  if p_thread <> 'team' and not exists (select 1 from public.agents where slug = p_thread) then
    raise exception 'not_found';
  end if;
  insert into public.agent_messages (thread, author_kind, author_id, author_name, body)
  values (p_thread, p_author_kind, p_author_id, p_author_name, p_body)
  returning id into v_id;
  insert into public.agent_runs (agent_id, cause, message_id)
  select a.id, 'message', v_id
  from public.agents a
  where a.slug = any (coalesce(p_wake, '{}')) and a.state <> 'off';
  return v_id;
end;
$$;

revoke execute on function public.workforce_post_message(text, text, text, text, text[], text)
  from public, anon, authenticated;
grant execute on function public.workforce_post_message(text, text, text, text, text[], text) to service_role;
