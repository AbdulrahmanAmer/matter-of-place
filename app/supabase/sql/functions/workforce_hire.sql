create or replace function public.workforce_hire(
  p_slug text,
  p_name text,
  p_role text,
  p_instructions text,
  p_model text,
  p_wake_on text[],
  p_tools text[],
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_request_id text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  -- W1: a new colleague, announced in the team chat. A taken handle raises 23505, which the admin answers as
  -- `already_exists`.
  insert into public.agents (slug, name, role, instructions, model, wake_on, tools, created_by)
  values (
    p_slug, p_name, p_role, coalesce(p_instructions, ''), coalesce(p_model, 'sonnet'),
    coalesce(p_wake_on, '{}'), coalesce(p_tools, '{}'),
    case when p_actor_kind = 'human' then p_actor end
  )
  returning id into v_id;
  insert into public.agent_messages (thread, author_kind, author_id, author_name, body)
  values ('team', 'system', 'system', 'Matter of Place', format('%s joined the team as %s.', p_name, p_role));
  perform public.write_audit(
    p_actor, p_actor_kind, 'workforce.hire', 'agents', v_id,
    null,
    jsonb_build_object('slug', p_slug, 'role', p_role),
    p_request_id
  );
  return v_id;
end;
$$;

revoke execute on function public.workforce_hire(
  text, text, text, text, text, text[], text[], uuid, public.actor_kind, text
) from public, anon, authenticated;
grant execute on function public.workforce_hire(
  text, text, text, text, text, text[], text[], uuid, public.actor_kind, text
) to service_role;
