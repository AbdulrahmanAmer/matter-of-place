create or replace function public.workforce_update_agent(
  p_slug text,
  p_change jsonb,
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
  -- W1: only the fields the person changed; a key absent from `p_change` keeps its value. The audit row names the
  -- fields, never the instructions' words.
  if jsonb_typeof(p_change) <> 'object' then
    raise exception 'validation';
  end if;
  update public.agents
  set
    name = coalesce(p_change ->> 'name', name),
    role = coalesce(p_change ->> 'role', role),
    instructions = coalesce(p_change ->> 'instructions', instructions),
    model = coalesce(p_change ->> 'model', model),
    wake_on = case when p_change ? 'wake_on'
      then array(select jsonb_array_elements_text(p_change -> 'wake_on')) else wake_on end,
    tools = case when p_change ? 'tools'
      then array(select jsonb_array_elements_text(p_change -> 'tools')) else tools end,
    state = coalesce(p_change ->> 'state', state)
  where slug = p_slug
  returning id into v_id;
  if v_id is null then
    raise exception 'not_found';
  end if;
  perform public.write_audit(
    p_actor, p_actor_kind, 'workforce.update', 'agents', v_id,
    null,
    jsonb_build_object('fields', (select coalesce(jsonb_agg(k order by k), '[]'::jsonb) from jsonb_object_keys(p_change) k)),
    p_request_id
  );
  return v_id;
end;
$$;

revoke execute on function public.workforce_update_agent(text, jsonb, uuid, public.actor_kind, text)
  from public, anon, authenticated;
grant execute on function public.workforce_update_agent(text, jsonb, uuid, public.actor_kind, text) to service_role;
