create or replace function public.replace_media(
  p_media_id uuid,
  p_staging_path text,
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
  v_before public.property_media;
  v_after public.property_media;
  v_job uuid;
begin
  select * into v_before from public.property_media m where m.id = p_media_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if p_staging_path is null or left(p_staging_path, length('staging/' || v_before.property_id::text || '/' || p_media_id::text || '.'))
      <> 'staging/' || v_before.property_id::text || '/' || p_media_id::text || '.' then
    raise exception 'invalid_image' using errcode = '22023',
      detail = 'The file is not the one this upload was made for.';
  end if;

  -- media_key, variants, sort_order and alt stay, so a published page shows the old image until B9's render stores
  -- the new one. render_job_id is cleared so the next render_variants job claims the row (PERF-01).
  update public.property_media m
  set staging_path = p_staging_path, render_job_id = null
  where m.id = p_media_id
  returning * into v_after;

  perform public.write_audit(
    p_actor, p_actor_kind, 'media.replace', 'property_media', p_media_id, to_jsonb(v_before), to_jsonb(v_after),
    p_request_id
  );
  v_job := public.request_property_render(v_before.property_id);
  return jsonb_build_object('previous_staging_path', v_before.staging_path, 'render_job_id', v_job);
end;
$$;

revoke execute on function public.replace_media(uuid, text, uuid, public.actor_kind, text)
  from public, anon, authenticated;
grant execute on function public.replace_media(uuid, text, uuid, public.actor_kind, text) to service_role;
