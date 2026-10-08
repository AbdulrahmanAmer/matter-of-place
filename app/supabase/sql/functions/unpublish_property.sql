create or replace function public.unpublish_property(
  p_property_id uuid,
  p_reason text,
  p_takedown boolean,
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_request_id text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before public.properties;
  v_after public.properties;
  v_job uuid;
  v_event uuid;
begin
  -- B7 invariant 13 (GP-03): a reason of unpublishReasons in src/domain/admin-properties.ts, and a note with `other`.
  if p_reason is null or p_reason not in ('owner_request', 'rights_takedown', 'factual_error', 'other') then
    raise exception 'validation' using errcode = '22023', detail = 'Choose a reason.';
  end if;
  if p_reason = 'other' and btrim(coalesce(p_note, '')) = '' then
    raise exception 'validation' using errcode = '22023', detail = 'Add a note for the reason.';
  end if;

  select * into v_before from public.properties p where p.id = p_property_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  -- A published property is unpublished; an archived one may still be taken down once.
  if not (
    v_before.editorial_state = 'published'
    or (p_takedown and v_before.editorial_state = 'archived' and v_before.taken_down_at is null)
  ) then
    raise exception 'wrong_state';
  end if;

  -- One update, so B2's trigger raises catalog_version once (F25 a); taken_down_at is the 410 marker of `gone`.
  update public.properties p
  set editorial_state = 'archived',
    published_at = null,
    archived_at = coalesce(p.archived_at, now()),
    unpublish_reason = p_reason,
    unpublished_at = now(),
    taken_down_at = case when p_takedown then now() else p.taken_down_at end,
    updated_by = p_actor
  where p.id = p_property_id
  returning * into v_after;

  if p_takedown then
    -- No social post of a taken down property goes out.
    for v_job in
      select j.id
      from public.jobs j
      where j.type in ('post_meta', 'post_x', 'post_linkedin')
        and j.status in ('queued', 'waiting_approval')
        and j.payload -> 'data' ->> 'property_id' = p_property_id::text
      order by j.id
    loop
      perform public.cancel_job(v_job, p_actor, 'takedown');
    end loop;
    -- E2E-01: the media leave the public bucket through B8's job (Storage and the purge API, so 12 attempts).
    perform public.enqueue_job(
      'takedown_media',
      jsonb_build_object('params', '{}'::jsonb, 'data', jsonb_build_object('property_id', p_property_id)),
      'takedown_media:' || p_property_id,
      p_max_attempts => 12
    );
  end if;

  perform public.write_audit(
    p_actor, p_actor_kind, 'properties.unpublish', 'property', p_property_id, to_jsonb(v_before), to_jsonb(v_after),
    p_request_id, p_note
  );
  v_event := public.emit_event(
    'property.unpublished', 'property', p_property_id,
    jsonb_build_object(
      'property_id', p_property_id,
      'slug', v_after.slug,
      'market', v_after.market_slug,
      'reason', p_reason,
      'takedown', p_takedown
    ),
    p_actor
  );
  return jsonb_build_object('event_id', v_event, 'version', v_after.version);
end;
$$;

revoke execute on function public.unpublish_property(uuid, text, boolean, uuid, public.actor_kind, text, text)
  from public, anon, authenticated;
grant execute on function public.unpublish_property(uuid, text, boolean, uuid, public.actor_kind, text, text)
  to service_role;
