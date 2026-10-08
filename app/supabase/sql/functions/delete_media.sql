create or replace function public.delete_media(
  p_media_id uuid,
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_request_id text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.property_media;
  v_state public.editorial_state;
  v_used boolean := false;
begin
  select * into v_row from public.property_media m where m.id = p_media_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  select p.editorial_state into v_state from public.properties p where p.id = v_row.property_id for update;
  -- A live page never loses a photograph under a reader; unpublish first.
  if v_state = 'published' then
    raise exception 'wrong_state' using detail = 'Unpublish the property before removing a photograph.';
  end if;
  -- B9's assets table may not exist yet, so it is read through execute, never named in the body.
  if v_row.media_key is not null and to_regclass('public.assets') is not null then
    execute
      'select exists (select 1 from public.assets a cross join lateral jsonb_array_elements(a.files) f
         where a.property_id = $1 and f ->> ''media_key'' = $2)'
      into v_used
      using v_row.property_id, v_row.media_key;
  end if;
  if v_used then
    raise exception 'media_in_use' using detail = 'A creative asset still uses this photograph.';
  end if;

  delete from public.property_media m where m.id = p_media_id;
  perform public.write_audit(
    p_actor, p_actor_kind, 'media.delete', 'property_media', p_media_id, to_jsonb(v_row), null, p_request_id
  );
  -- The service removes the staged object, if any.
  return v_row.staging_path;
end;
$$;

revoke execute on function public.delete_media(uuid, uuid, public.actor_kind, text) from public, anon, authenticated;
grant execute on function public.delete_media(uuid, uuid, public.actor_kind, text) to service_role;
