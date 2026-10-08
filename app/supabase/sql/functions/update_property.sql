create or replace function public.update_property(
  p_id uuid,
  p_expected_version integer,
  p_patch jsonb,
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
  v_before public.properties;
  v_after public.properties;
  v_state public.editorial_state := (p_patch ->> 'editorial_state')::public.editorial_state;
begin
  -- B7 invariant 7 (GD-01): B2's save_property holds the lock and the version; this function only audits. The one key
  -- beyond its allow-list is the editor's move between draft and review (ASSUMED: the plan names no other path).
  select * into v_before from public.properties p where p.id = p_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_state is not null and v_state not in ('draft', 'review') then
    raise exception 'invalid_patch_key' using errcode = '22023';
  end if;
  v_after := public.save_property(
    p_id, p_expected_version, (p_patch - 'editorial_state') || jsonb_build_object('updated_by', p_actor)
  );
  if v_state is not null and v_state <> v_after.editorial_state then
    update public.properties p set editorial_state = v_state, archived_at = null where p.id = p_id returning * into v_after;
  end if;
  perform public.write_audit(
    p_actor, p_actor_kind, 'properties.update', 'property', p_id, to_jsonb(v_before), to_jsonb(v_after),
    p_request_id
  );
  return v_after.version;
end;
$$;

revoke execute on function public.update_property(uuid, integer, jsonb, uuid, public.actor_kind, text)
  from public, anon, authenticated;
grant execute on function public.update_property(uuid, integer, jsonb, uuid, public.actor_kind, text)
  to service_role;
