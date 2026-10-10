create or replace function public.revoke_all_agent_keys(
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_request_id text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  -- Every live key at once; `verifyKey` looks the key up on each request, so the next call of any of them is 401.
  update public.agent_keys k set revoked_at = now() where k.revoked_at is null;
  get diagnostics v_count = row_count;
  perform public.write_audit(
    p_actor, p_actor_kind, 'team.revoke_all_keys', 'agent_keys', null, null,
    jsonb_build_object('count', v_count), p_request_id
  );
  return v_count;
end;
$$;

revoke execute on function public.revoke_all_agent_keys(uuid, public.actor_kind, text)
  from public, anon, authenticated;
grant execute on function public.revoke_all_agent_keys(uuid, public.actor_kind, text) to service_role;
