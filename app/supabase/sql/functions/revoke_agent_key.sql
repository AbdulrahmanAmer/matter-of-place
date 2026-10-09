create or replace function public.revoke_agent_key(
  p_key uuid,
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_request_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_revoked_at timestamptz;
begin
  select k.revoked_at into v_revoked_at from public.agent_keys k where k.id = p_key for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_revoked_at is not null then
    raise exception 'wrong_state';
  end if;
  update public.agent_keys k set revoked_at = now() where k.id = p_key;
  perform public.write_audit(
    p_actor, p_actor_kind, 'team.agent_key_revoke', 'agent_keys', p_key,
    jsonb_build_object('id', p_key, 'revoked', false), jsonb_build_object('id', p_key, 'revoked', true),
    p_request_id
  );
end;
$$;

revoke execute on function public.revoke_agent_key(uuid, uuid, public.actor_kind, text)
  from public, anon, authenticated;
grant execute on function public.revoke_agent_key(uuid, uuid, public.actor_kind, text) to service_role;
