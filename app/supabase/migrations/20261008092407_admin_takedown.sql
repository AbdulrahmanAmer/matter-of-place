-- down:
--   drop function public.rotate_preview_nonce(uuid, uuid, public.actor_kind, text),
--     public.issue_agent_preview(uuid, integer, uuid, public.actor_kind, text),
--     public.unpublish_property(uuid, text, boolean, uuid, public.actor_kind, text, text);
set lock_timeout = '5s';

-- B7 step 7a: unpublish and takedown (invariant 13, E2E-01), the agent's preview link and its revocation
-- (invariant 14). No column: unpublish_reason, unpublished_at and taken_down_at are B2's (G23).

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
  -- A takedown also takes a new preview_nonce, so no preview link issued before it still opens the dossier.
  update public.properties p
  set editorial_state = 'archived',
    published_at = null,
    archived_at = coalesce(p.archived_at, now()),
    unpublish_reason = p_reason,
    unpublished_at = now(),
    taken_down_at = case when p_takedown then now() else p.taken_down_at end,
    preview_nonce = case when p_takedown then gen_random_uuid() else p.preview_nonce end,
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
