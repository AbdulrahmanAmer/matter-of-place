-- down:
--   drop function public.delete_media(uuid, uuid, public.actor_kind, text),
--     public.replace_media(uuid, text, uuid, public.actor_kind, text),
--     public.set_media_alt(uuid, text, uuid, public.actor_kind, text),
--     public.reorder_media(uuid, uuid[], uuid, public.actor_kind, text),
--     public.attach_media(uuid, uuid, text, uuid, public.actor_kind, text, text),
--     public.request_property_render(uuid);
set lock_timeout = '5s';

-- B7 step 8: the photographs of a property (screen 9 and the Sequence tab). An upload is staged in the private
-- bucket submissions and rendered by B9's render_variants, one job per property per upload burst (ruling H3, G66).
-- No column: staging_path and render_job_id are B2's (G25, PERF-01).

create or replace function public.request_property_render(p_property_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job uuid;
  v_slug text;
begin
  -- B7 invariant 21 (b), ruling H3: one pending render_variants job per property per upload burst. The lock makes two
  -- transactions that attach at once meet one job; B9's claim_media_for_render gives it every staged row.
  perform pg_advisory_xact_lock(hashtext('render_variants:' || p_property_id::text));
  select j.id into v_job
  from public.jobs j
  where j.type = 'render_variants'
    and j.status = 'queued'
    and j.payload -> 'data' ->> 'property_id' = p_property_id::text
  order by j.created_at, j.id
  limit 1;
  if v_job is not null then
    return v_job;
  end if;
  select p.slug into v_slug from public.properties p where p.id = p_property_id;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  return public.enqueue_job(
    'render_variants',
    jsonb_build_object(
      'params', '{}'::jsonb,
      'data', jsonb_build_object('property_id', p_property_id, 'slug', v_slug)
    ),
    'render_variants:' || p_property_id::text || ':' || gen_random_uuid()::text,
    p_heavy => true,
    p_run_after => now() + interval '90 seconds',
    p_max_attempts => 12
  );
end;
$$;

revoke execute on function public.request_property_render(uuid) from public, anon, authenticated;
grant execute on function public.request_property_render(uuid) to service_role;

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

create or replace function public.reorder_media(
  p_property_id uuid,
  p_order uuid[],
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
  v_before uuid[];
begin
  perform 1 from public.properties p where p.id = p_property_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  select coalesce(array_agg(m.id order by m.sort_order, m.id), '{}') into v_before
  from public.property_media m
  where m.property_id = p_property_id;
  -- The new order names every photograph of the property once, and nothing else.
  if cardinality(coalesce(p_order, '{}')) <> cardinality(v_before)
    or (select count(distinct o) from unnest(p_order) o) <> cardinality(v_before)
    or not (p_order <@ v_before) then
    raise exception 'reorder_mismatch' using errcode = '22023', detail = 'Name every photograph once.';
  end if;

  -- One statement, so B2's statement trigger raises catalog_version once; the first photograph is the hero (G66).
  update public.property_media m
  set sort_order = (o.position - 1)::integer
  from unnest(p_order) with ordinality as o (id, position)
  where m.id = o.id and m.property_id = p_property_id and m.sort_order <> o.position - 1;

  perform public.write_audit(
    p_actor, p_actor_kind, 'media.reorder', 'property', p_property_id,
    jsonb_build_object('id', p_property_id, 'media_order', to_jsonb(v_before)),
    jsonb_build_object('id', p_property_id, 'media_order', to_jsonb(p_order)),
    p_request_id
  );
  return cardinality(p_order);
end;
$$;

revoke execute on function public.reorder_media(uuid, uuid[], uuid, public.actor_kind, text)
  from public, anon, authenticated;
grant execute on function public.reorder_media(uuid, uuid[], uuid, public.actor_kind, text) to service_role;

create or replace function public.set_media_alt(
  p_media_id uuid,
  p_alt text,
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_request_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before public.property_media;
  v_after public.property_media;
begin
  select * into v_before from public.property_media m where m.id = p_media_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  update public.property_media m
  set alt = nullif(btrim(p_alt), '')
  where m.id = p_media_id
  returning * into v_after;
  perform public.write_audit(
    p_actor, p_actor_kind, 'media.alt', 'property_media', p_media_id, to_jsonb(v_before), to_jsonb(v_after),
    p_request_id
  );
end;
$$;

revoke execute on function public.set_media_alt(uuid, text, uuid, public.actor_kind, text)
  from public, anon, authenticated;
grant execute on function public.set_media_alt(uuid, text, uuid, public.actor_kind, text) to service_role;

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
