create or replace function public.create_agent_key(
  p_user uuid,
  p_hash text,
  p_label text,
  p_scopes text[],
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
  -- Only the sha256 of the key arrives here; the key itself is shown once by the Worker and never stored.
  if not exists (select 1 from public.user_roles r where r.user_id = p_user and r.actor_kind = 'agent') then
    raise exception 'invalid_kind';
  end if;
  -- `team` and `settings` are never an agent's (invariant 3).
  if p_scopes && array['team', 'settings'] then
    raise exception 'validation' using errcode = '22023';
  end if;
  insert into public.agent_keys (user_id, key_hash, label, scopes)
  values (p_user, p_hash, p_label, p_scopes)
  returning id into v_id;
  perform public.write_audit(
    p_actor, p_actor_kind, 'team.agent_key_create', 'agent_keys', v_id, null,
    jsonb_build_object('id', v_id, 'user_id', p_user, 'label', p_label, 'scopes', to_jsonb(p_scopes)),
    p_request_id
  );
  return v_id;
end;
$$;

revoke execute on function public.create_agent_key(uuid, text, text, text[], uuid, public.actor_kind, text)
  from public, anon, authenticated;
grant execute on function public.create_agent_key(uuid, text, text, text[], uuid, public.actor_kind, text)
  to service_role;
