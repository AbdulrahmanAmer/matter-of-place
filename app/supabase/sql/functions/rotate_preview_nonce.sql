create or replace function public.rotate_preview_nonce(
  p_property_id uuid,
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
begin
  -- B7 invariant 14: a new nonce voids every editor and agent link of this property, and of no other.
  select * into v_before from public.properties p where p.id = p_property_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  update public.properties p
  set preview_nonce = gen_random_uuid(), updated_by = p_actor
  where p.id = p_property_id
  returning * into v_after;
  -- The nonces stay out of the audit row: staff read it, and a nonce is half of a link.
  perform public.write_audit(
    p_actor, p_actor_kind, 'properties.revoke_previews', 'property', p_property_id,
    to_jsonb(v_before) - 'preview_nonce', to_jsonb(v_after) - 'preview_nonce', p_request_id
  );
  return v_after.version;
end;
$$;

revoke execute on function public.rotate_preview_nonce(uuid, uuid, public.actor_kind, text)
  from public, anon, authenticated;
grant execute on function public.rotate_preview_nonce(uuid, uuid, public.actor_kind, text) to service_role;
