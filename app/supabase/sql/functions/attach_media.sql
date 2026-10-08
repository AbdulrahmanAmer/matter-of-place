create or replace function public.attach_media(
  p_media_id uuid,
  p_property_id uuid,
  p_staging_path text,
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_request_id text,
  p_alt text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.property_media;
  v_job uuid;
begin
  -- The property row lock orders two attaches of one property, so each takes the next position.
  perform 1 from public.properties p where p.id = p_property_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  -- The object name createStagingUpload made for this photograph (G42); the service refuses any other first.
  if p_staging_path is null or left(p_staging_path, length('staging/' || p_property_id::text || '/' || p_media_id::text || '.'))
      <> 'staging/' || p_property_id::text || '/' || p_media_id::text || '.' then
    raise exception 'invalid_image' using errcode = '22023',
      detail = 'The file is not the one this upload was made for.';
  end if;
  if exists (select 1 from public.property_media m where m.id = p_media_id) then
    raise exception 'already_exists' using errcode = '23505';
  end if;

  -- Staged until B9's render_variants stores it: no media_key, no orientation (G63), no variants.
  insert into public.property_media (id, property_id, staging_path, alt, sort_order)
  select p_media_id, p_property_id, p_staging_path, nullif(btrim(p_alt), ''),
    coalesce(max(m.sort_order) + 1, 0)
  from public.property_media m
  where m.property_id = p_property_id
  returning * into v_row;

  perform public.write_audit(
    p_actor, p_actor_kind, 'media.attach', 'property_media', p_media_id, null, to_jsonb(v_row), p_request_id
  );
  -- G66: rendered when attached, on a draft as on a published property.
  v_job := public.request_property_render(p_property_id);
  return jsonb_build_object('media_id', p_media_id, 'sort_order', v_row.sort_order, 'render_job_id', v_job);
end;
$$;

revoke execute on function public.attach_media(uuid, uuid, text, uuid, public.actor_kind, text, text)
  from public, anon, authenticated;
grant execute on function public.attach_media(uuid, uuid, text, uuid, public.actor_kind, text, text) to service_role;
