create or replace function public.attach_reel(p_property uuid, p_asset uuid, p_detach boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asset public.assets;
  v_property public.properties;
  v_video text;
  v_poster text;
  v_seconds int;
  v_film jsonb;
begin
  -- B12: an approved reel is the dossier's film (G23); its keys in bucket `media`, never URLs (A13). The one update
  -- fires B2's properties triggers: the catalog version moves once and `properties.version` does not (DB-16).
  select * into v_asset from public.assets a where a.id = p_asset;
  select * into v_property from public.properties p where p.id = p_property for update;
  v_video := (select f ->> 'media_key' from jsonb_array_elements(v_asset.files) f where f ->> 'role' = 'video' limit 1);
  v_poster := (select f ->> 'media_key' from jsonb_array_elements(v_asset.files) f where f ->> 'role' = 'poster' limit 1);

  if p_detach then
    -- Only the film this asset put there: a newer approved revision keeps its own.
    if v_video is null or v_property.video ->> 'src' is distinct from v_video then
      return;
    end if;
    update public.properties set video = null where id = p_property;
    perform public.write_audit(
      null, null, 'properties.video_detach', 'properties', p_property,
      jsonb_build_object('video', v_property.video), jsonb_build_object('video', null), null, 'system'
    );
    return;
  end if;

  if v_video is null or v_poster is null or v_asset.meta ->> 'duration_s' is null then
    raise exception 'reel_files_missing' using errcode = '23514';
  end if;
  v_seconds := round((v_asset.meta ->> 'duration_s')::numeric)::int;
  v_film := jsonb_build_object(
    'src', v_video,
    'poster', v_poster,
    'caption', coalesce(v_asset.alt_text, 'Film of ' || v_property.title),
    'duration', format('%s:%s', v_seconds / 60, lpad((v_seconds % 60)::text, 2, '0'))
  );
  update public.properties set video = v_film where id = p_property;
  -- A system row (G43): the approver is on the assets.approve row of the same transaction, and write_audit refuses a
  -- human actor on an action the matrix does not hold.
  perform public.write_audit(
    null, null, 'properties.video_attach', 'properties', p_property,
    jsonb_build_object('video', v_property.video), jsonb_build_object('video', v_film), null, 'system'
  );
end;
$$;

revoke execute on function public.attach_reel(uuid, uuid, boolean) from public, anon, authenticated;
