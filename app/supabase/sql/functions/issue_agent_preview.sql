create or replace function public.issue_agent_preview(
  p_property_id uuid,
  p_expected_version integer,
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before public.properties;
  v_after public.properties;
begin
  -- B7 invariant 14 (GG-07): the lock and the version the editor read (GD-01), then the move to agent review. The
  -- Worker signs the 7 day link with the nonce this returns.
  select * into v_before from public.properties p where p.id = p_property_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_before.version <> p_expected_version then
    raise exception 'version_conflict' using errcode = '40001';
  end if;
  if v_before.editorial_state not in ('draft', 'review', 'agent_review') then
    raise exception 'wrong_state';
  end if;

  if v_before.editorial_state = 'agent_review' then
    v_after := v_before;
  else
    update public.properties p
    set editorial_state = 'agent_review', updated_by = p_actor
    where p.id = p_property_id
    returning * into v_after;
  end if;

  -- Every link sent is audited, a second one to the same agent too.
  perform public.write_audit(
    p_actor, p_actor_kind, 'properties.agent_preview', 'property', p_property_id, to_jsonb(v_before),
    to_jsonb(v_after), p_request_id
  );
  return jsonb_build_object('slug', v_after.slug, 'preview_nonce', v_after.preview_nonce, 'version', v_after.version);
end;
$$;

revoke execute on function public.issue_agent_preview(uuid, integer, uuid, public.actor_kind, text)
  from public, anon, authenticated;
grant execute on function public.issue_agent_preview(uuid, integer, uuid, public.actor_kind, text) to service_role;
