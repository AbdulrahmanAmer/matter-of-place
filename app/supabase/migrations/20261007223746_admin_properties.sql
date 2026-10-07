-- down:
--   drop index public.representatives_name_idx; drop index public.properties_list_idx;
--   drop function public.list_representatives(integer, text, text, uuid),
--     public.list_properties(integer, public.editorial_state[], text, timestamptz, uuid),
--     public.property_detail(uuid), public.preview_property(uuid),
--     public.upsert_representative(jsonb, uuid, public.actor_kind, text, uuid),
--     public.set_features(uuid, integer, text[], uuid, public.actor_kind, text),
--     public.set_related(uuid, integer, text[], uuid, public.actor_kind, text),
--     public.set_ranks(uuid, integer, uuid, public.actor_kind, text, integer, integer),
--     public.publish_property(uuid, integer, uuid, public.actor_kind, text),
--     public.update_property(uuid, integer, jsonb, uuid, public.actor_kind, text),
--     public.create_property_from_submission(uuid, uuid, public.actor_kind, text),
--     public.market_timezone(text);
set lock_timeout = '5s';

-- B7 invariant 17c: the lists of screen 7 and of the Representation tab page on these.
create index properties_list_idx on public.properties (editorial_state, updated_at desc, id);
create index representatives_name_idx on public.representatives (lower(name), id);

create or replace function public.market_timezone(p_market_slug text)
returns text
language sql
immutable
security definer
set search_path = ''
as $$
  -- B7 invariant 8 (DL-09): mirrors marketTimezone of src/domain/market-time.ts.
  select case when p_market_slug = 'california' then 'America/Los_Angeles' else 'America/New_York' end;
$$;

revoke execute on function public.market_timezone(text) from public, anon, authenticated;
grant execute on function public.market_timezone(text) to service_role;

create or replace function public.create_property_from_submission(
  p_submission_id uuid,
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
  v_sub public.submissions;
  v_id uuid;
  v_base text;
  v_slug text;
  v_suffix integer := 1;
  v_representative uuid;
  v_after public.properties;
  v_job uuid;
begin
  -- DL-02: serialised with B6's activate_submission on the submission row; B2's unique index on
  -- properties.submission_id is the backstop.
  perform 1 from public.submissions s where s.id = p_submission_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  -- Idempotent: a second call returns the property and its copy job and writes nothing.
  select p.id into v_id from public.properties p where p.submission_id = p_submission_id;
  if found then
    return jsonb_build_object(
      'property_id', v_id,
      'copy_job_id', (
        select j.id from public.jobs j where j.idempotency_key = 'copy_submission_media:' || v_id::text
      )
    );
  end if;
  select * into v_sub from public.submissions s where s.id = p_submission_id;
  if v_sub.accepted_at is null or v_sub.workflow_state not in (
    'Accepted', 'Awaiting Assets', 'Invoice Issued', 'Scheduled', 'Published', 'Distribution Active', 'Completed'
  ) then
    raise exception 'wrong_state';
  end if;

  -- G62: the city slugified, then the first eight characters of the id; editable until the first publication.
  v_id := gen_random_uuid();
  v_base := btrim(left(regexp_replace(lower(v_sub.city), '[^a-z0-9]+', '-', 'g'), 100), '-');
  v_base := case when v_base = '' then '' else v_base || '-' end || left(v_id::text, 8);
  v_slug := v_base;
  while exists (select 1 from public.properties p where p.slug = v_slug)
    or exists (select 1 from public.slug_history h where h.slug = v_slug) loop
    v_suffix := v_suffix + 1;
    v_slug := v_base || '-' || v_suffix::text;
  end loop;

  -- S55: an agent's request links the representative with that address (or a new one); an owner's links none.
  if v_sub.submitter_kind = 'agent' then
    select r.id into v_representative
    from public.representatives r
    where lower(r.email) = lower(v_sub.submitter_email)
    order by r.created_at, r.id
    limit 1;
    if not found then
      insert into public.representatives (name, brokerage, email, phone)
      values (v_sub.submitter_name, coalesce(v_sub.brokerage, ''), v_sub.submitter_email, v_sub.submitter_phone)
      returning id into v_representative;
    end if;
  end if;

  -- Every column the request has no value for stays null until an editor fills it (G62); B7 writes no placeholder.
  insert into public.properties (
    id, slug, title, market_slug, city, state, country, address, price, beds, baths, interior_sq_ft, year_built,
    type, architect, designer, listing_url, story, status, source, submission_id, created_by, updated_by,
    editorial_state, representative_id, presented_by_owner
  ) values (
    v_id, v_slug, v_sub.address,
    case v_sub.state when 'California' then 'california' when 'New York' then 'new-york' else 'florida' end,
    v_sub.city, v_sub.state::text, 'United States', v_sub.address, v_sub.price, v_sub.beds, v_sub.baths,
    v_sub.interior_sq_ft, v_sub.year_built, v_sub.property_type, v_sub.architect, v_sub.designer,
    v_sub.listing_url, array[v_sub.story], 'Active', 'Submission', p_submission_id, p_actor, p_actor,
    'draft', v_representative, v_sub.submitter_kind = 'owner'
  )
  returning * into v_after;

  -- Invariant 21 (a): each row takes the id of the photograph it copies, so the copy job finds its source by id.
  insert into public.property_media (id, property_id, staging_path, sort_order)
  select m.id, v_id,
    'staging/' || v_id::text || '/' || m.id::text || '.' || substring(m.storage_path from '\.([^./]+)$'),
    (row_number() over (order by m.sort_order, m.uploaded_at, m.id) - 1)::integer
  from public.submission_media m
  where m.submission_id = p_submission_id and m.uploaded_at is not null;

  perform public.write_audit(
    p_actor, p_actor_kind, 'properties.create_from_submission', 'property', v_id, null, to_jsonb(v_after),
    p_request_id
  );
  -- E2E-02, PERF-07: the photographs are copied by the job runner, never inside a request.
  v_job := public.enqueue_job(
    'copy_submission_media',
    jsonb_build_object('params', '{}'::jsonb, 'data', jsonb_build_object('property_id', v_id)),
    'copy_submission_media:' || v_id::text
  );
  return jsonb_build_object('property_id', v_id, 'copy_job_id', v_job);
end;
$$;

revoke execute on function public.create_property_from_submission(uuid, uuid, public.actor_kind, text)
  from public, anon, authenticated;
grant execute on function public.create_property_from_submission(uuid, uuid, public.actor_kind, text)
  to service_role;

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

create or replace function public.publish_property(
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
  v_missing text[];
  v_state public.submission_state;
  v_first boolean;
  v_today date;
  v_event uuid;
begin
  -- B7 invariants 3 and 8: counted against an agent's daily publishes, then the lock and the version (GD-01).
  perform public.assert_agent_daily_cap(p_actor, p_actor_kind, 'publish');
  v_before := public.save_property(p_property_id, p_expected_version, '{}'::jsonb);
  if v_before.editorial_state not in ('review', 'agent_review') then
    raise exception 'wrong_state';
  end if;
  -- G62: every field the public page needs, the hero and six photographs with alt text; the message names each gap.
  v_missing := array_remove(array[
    case when v_before.region_slug is null then 'region_slug' end,
    case when v_before.neighborhood is null then 'neighborhood' end,
    case when v_before.country is null then 'country' end,
    case when v_before.price is null then 'price' end,
    case when v_before.beds is null then 'beds' end,
    case when v_before.baths is null then 'baths' end,
    case when v_before.interior_sq_ft is null then 'interior_sq_ft' end,
    case when v_before.lot_acres is null then 'lot_acres' end,
    case when v_before.year_built is null then 'year_built' end,
    case when v_before.style is null then 'style' end,
    case when v_before.hero_image is null then 'hero_image' end,
    case when v_before.place is null then 'place' end,
    case when (
      select count(*) from public.property_media m
      where m.property_id = p_property_id and m.media_key is not null and btrim(coalesce(m.alt, '')) <> ''
    ) < 6 then 'six images with alt text' end
  ], null);
  if cardinality(v_missing) > 0 then
    raise exception 'publish_incomplete' using errcode = '23514', detail = 'Missing: ' || array_to_string(v_missing, ', ');
  end if;

  -- DL-03: the request gates the first publication only, and moves to Published with it.
  v_first := v_before.first_published_at is null;
  if v_before.submission_id is not null then
    select s.workflow_state into v_state from public.submissions s where s.id = v_before.submission_id for update;
    if v_first then
      if v_state <> 'Scheduled' then
        raise exception 'wrong_state';
      end if;
      update public.submissions s set workflow_state = 'Published' where s.id = v_before.submission_id;
    elsif v_state not in ('Published', 'Distribution Active', 'Completed') then
      raise exception 'wrong_state';
    end if;
  end if;

  update public.properties p
  set editorial_state = 'published', published_at = now(), updated_by = p_actor
  where p.id = p_property_id
  returning * into v_after;

  -- DL-09: the campaign runs from the first publication's day in the market's zone; a republish keeps its dates.
  if v_first then
    v_today := (now() at time zone public.market_timezone(v_after.market_slug))::date;
    update public.campaigns c
    set starts_on = v_today,
      ends_on = v_today + public.package_duration_days(c.package) - 1
    where c.property_id = p_property_id;
  end if;

  perform public.write_audit(
    p_actor, p_actor_kind, 'properties.publish', 'property', p_property_id, to_jsonb(v_before), to_jsonb(v_after),
    p_request_id
  );
  v_event := public.emit_event(
    'property.published', 'property', p_property_id,
    jsonb_strip_nulls(jsonb_build_object(
      'property_id', p_property_id,
      'slug', v_after.slug,
      'tier', v_after.campaign_tier,
      'market', v_after.market_slug,
      'submission_id', v_after.submission_id
    )),
    p_actor
  );
  return jsonb_build_object('event_id', v_event, 'version', v_after.version);
end;
$$;

revoke execute on function public.publish_property(uuid, integer, uuid, public.actor_kind, text)
  from public, anon, authenticated;
grant execute on function public.publish_property(uuid, integer, uuid, public.actor_kind, text) to service_role;

create or replace function public.set_ranks(
  p_property_id uuid,
  p_expected_version integer,
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_request_id text,
  p_hero_rank integer default null,
  p_featured_rank integer default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before public.properties;
  v_after public.properties;
  v_hero_holder uuid;
  v_featured_holder uuid;
begin
  -- B7 invariant 7: a rank another property holds is swapped in this transaction, so each rank stays unique.
  select * into v_before from public.properties p where p.id = p_property_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  select p.id into v_hero_holder from public.properties p
  where p.hero_rank = p_hero_rank and p.id <> p_property_id for update;
  select p.id into v_featured_holder from public.properties p
  where p.featured_rank = p_featured_rank and p.id <> p_property_id for update;
  update public.properties p set hero_rank = null where p.id = v_hero_holder;
  update public.properties p set featured_rank = null where p.id = v_featured_holder;
  v_after := public.save_property(
    p_property_id, p_expected_version,
    jsonb_build_object('hero_rank', p_hero_rank, 'featured_rank', p_featured_rank, 'updated_by', p_actor)
  );
  update public.properties p set hero_rank = v_before.hero_rank where p.id = v_hero_holder;
  update public.properties p set featured_rank = v_before.featured_rank where p.id = v_featured_holder;
  perform public.write_audit(
    p_actor, p_actor_kind, 'properties.rank', 'property', p_property_id, to_jsonb(v_before), to_jsonb(v_after),
    p_request_id
  );
  return v_after.version;
end;
$$;

revoke execute on function public.set_ranks(uuid, integer, uuid, public.actor_kind, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.set_ranks(uuid, integer, uuid, public.actor_kind, text, integer, integer)
  to service_role;

create or replace function public.set_related(
  p_property_id uuid,
  p_expected_version integer,
  p_related text[],
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
  v_before text[];
  v_after public.properties;
begin
  -- B7 invariant 7: the lock and the version first, then the whole ordered list replaced.
  v_after := public.save_property(p_property_id, p_expected_version, '{}'::jsonb);
  if cardinality(p_related) <> (select count(distinct slug) from unnest(p_related) slug) then
    raise exception 'invalid_key';
  end if;
  select coalesce(array_agg(r.related_slug order by r.sort_order, r.related_slug), '{}') into v_before
  from public.property_related r where r.property_id = p_property_id;
  delete from public.property_related r where r.property_id = p_property_id;
  insert into public.property_related (property_id, related_slug, sort_order)
  select p_property_id, slug, (position - 1)::integer
  from unnest(p_related) with ordinality as listed (slug, position);
  perform public.write_audit(
    p_actor, p_actor_kind, 'properties.update', 'property', p_property_id, jsonb_build_object('related', v_before),
    jsonb_build_object('related', p_related), p_request_id
  );
  return v_after.version;
end;
$$;

revoke execute on function public.set_related(uuid, integer, text[], uuid, public.actor_kind, text)
  from public, anon, authenticated;
grant execute on function public.set_related(uuid, integer, text[], uuid, public.actor_kind, text) to service_role;

create or replace function public.set_features(
  p_property_id uuid,
  p_expected_version integer,
  p_features text[],
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
  v_before text[];
  v_after public.properties;
begin
  -- B7 invariant 7: the lock and the version first, then the whole ordered list replaced.
  v_after := public.save_property(p_property_id, p_expected_version, '{}'::jsonb);
  if cardinality(p_features) <> (select count(distinct feature) from unnest(p_features) feature) then
    raise exception 'invalid_key';
  end if;
  select coalesce(array_agg(r.feature order by r.sort_order, r.feature), '{}') into v_before
  from public.property_features r where r.property_id = p_property_id;
  delete from public.property_features r where r.property_id = p_property_id;
  insert into public.property_features (property_id, feature, sort_order)
  select p_property_id, feature, (position - 1)::integer
  from unnest(p_features) with ordinality as listed (feature, position);
  perform public.write_audit(
    p_actor, p_actor_kind, 'properties.update', 'property', p_property_id, jsonb_build_object('features', v_before),
    jsonb_build_object('features', p_features), p_request_id
  );
  return v_after.version;
end;
$$;

revoke execute on function public.set_features(uuid, integer, text[], uuid, public.actor_kind, text)
  from public, anon, authenticated;
grant execute on function public.set_features(uuid, integer, text[], uuid, public.actor_kind, text) to service_role;

create or replace function public.upsert_representative(
  p_fields jsonb,
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_request_id text,
  p_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before public.representatives;
  v_after public.representatives;
begin
  -- B7: name, brokerage, license, email and phone only; the photo has no upload here. B2's trigger on representatives
  -- bumps catalog_version.
  if exists (
    select 1 from jsonb_object_keys(p_fields) k where k not in ('name', 'brokerage', 'license', 'email', 'phone')
  ) then
    raise exception 'invalid_patch_key' using errcode = '22023';
  end if;
  if p_id is null then
    insert into public.representatives (name, brokerage, license, email, phone)
    values (
      p_fields ->> 'name', p_fields ->> 'brokerage', p_fields ->> 'license', p_fields ->> 'email', p_fields ->> 'phone'
    )
    returning * into v_after;
  else
    select * into v_before from public.representatives r where r.id = p_id for update;
    if not found then
      raise exception 'not_found' using errcode = 'P0002';
    end if;
    update public.representatives r
    set name = case when p_fields ? 'name' then p_fields ->> 'name' else r.name end,
      brokerage = case when p_fields ? 'brokerage' then p_fields ->> 'brokerage' else r.brokerage end,
      license = case when p_fields ? 'license' then p_fields ->> 'license' else r.license end,
      email = case when p_fields ? 'email' then p_fields ->> 'email' else r.email end,
      phone = case when p_fields ? 'phone' then p_fields ->> 'phone' else r.phone end
    where r.id = p_id
    returning * into v_after;
  end if;
  perform public.write_audit(
    p_actor, p_actor_kind, 'properties.representative_put', 'representative', v_after.id, to_jsonb(v_before),
    to_jsonb(v_after), p_request_id
  );
  return v_after.id;
end;
$$;

revoke execute on function public.upsert_representative(jsonb, uuid, public.actor_kind, text, uuid)
  from public, anon, authenticated;
grant execute on function public.upsert_representative(jsonb, uuid, public.actor_kind, text, uuid) to service_role;

create or replace function public.preview_property(p_property_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  -- B7 invariant 17 (f): the one public read of a row in any editorial state, called only by
  -- src/server/previews/service.ts after the token's signature and expiry pass. `property` has the shape of
  -- public_catalog_snapshot's property object; a draft is shown as if it were published now. Null when no row.
  select jsonb_build_object(
    'preview_nonce', p.preview_nonce,
    'representative', (select to_jsonb(r) from public.representatives r where r.id = p.representative_id),
    'property', jsonb_build_object(
      'id', p.id,
      'slug', p.slug,
      'title', p.title,
      'market_slug', p.market_slug,
      'region_slug', p.region_slug,
      'city', p.city,
      'neighborhood', p.neighborhood,
      'state', p.state,
      'country', p.country,
      'address', p.address,
      'coordinates', case when p.coordinates is not null then jsonb_build_array(p.coordinates[0], p.coordinates[1]) end,
      'price', p.price,
      'currency', p.currency,
      'beds', p.beds,
      'baths', p.baths,
      'interior_sq_ft', p.interior_sq_ft,
      'lot_acres', p.lot_acres,
      'year_built', p.year_built,
      'type', p.type,
      'style', p.style,
      'architect', p.architect,
      'designer', p.designer,
      'status', p.status,
      'hero_image', p.hero_image,
      'video', p.video,
      'og_image_key', p.og_image_key,
      'story', p.story,
      'place', p.place,
      'representative_id', p.representative_id,
      'presented_by_owner', p.presented_by_owner,
      'listing_url', p.listing_url,
      'hero_rank', p.hero_rank,
      'featured_rank', p.featured_rank,
      'published_at', coalesce(p.published_at, now()),
      'updated_at', p.updated_at,
      'media', coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id', m.id,
              'media_key', m.media_key,
              'variants', m.variants,
              'alt', m.alt,
              'orientation', m.orientation,
              'sort_order', m.sort_order
            )
            order by m.sort_order, m.id
          )
          from public.property_media m
          where m.property_id = p.id and m.media_key is not null
        ),
        '[]'::jsonb
      ),
      'features', coalesce(
        (
          select jsonb_agg(f.feature order by f.sort_order, f.feature)
          from public.property_features f
          where f.property_id = p.id
        ),
        '[]'::jsonb
      ),
      'related', coalesce(
        (
          select jsonb_agg(rp.related_slug order by rp.sort_order, rp.related_slug)
          from public.property_related rp
          where rp.property_id = p.id
        ),
        '[]'::jsonb
      )
    )
  )
  from public.properties p
  where p.id = p_property_id;
$$;

revoke execute on function public.preview_property(uuid) from public, anon, authenticated;
grant execute on function public.preview_property(uuid) to service_role;

create or replace function public.property_detail(p_property_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  -- Screen 8 (B7 step 7): the row with its version (GD-01), its photographs in sequence, its lists, its
  -- representative and the request it came from, in one call. Null when there is no such property.
  select jsonb_build_object(
    'property', to_jsonb(p) - array['search_text', 'preview_nonce', 'coordinates', 'video'],
    'media', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', m.id, 'media_key', m.media_key, 'staging_path', m.staging_path, 'alt', m.alt,
            'orientation', m.orientation, 'sort_order', m.sort_order
          )
          order by m.sort_order, m.id
        )
        from public.property_media m
        where m.property_id = p.id
      ),
      '[]'::jsonb
    ),
    'features', coalesce(
      (
        select jsonb_agg(f.feature order by f.sort_order, f.feature)
        from public.property_features f where f.property_id = p.id
      ),
      '[]'::jsonb
    ),
    'related', coalesce(
      (
        select jsonb_agg(r.related_slug order by r.sort_order, r.related_slug)
        from public.property_related r where r.property_id = p.id
      ),
      '[]'::jsonb
    ),
    'representative', (
      select jsonb_build_object(
        'id', r.id, 'name', r.name, 'brokerage', r.brokerage, 'license', r.license, 'email', r.email, 'phone', r.phone
      )
      from public.representatives r where r.id = p.representative_id
    ),
    'submission', (
      select jsonb_build_object('id', s.id, 'workflow_state', s.workflow_state, 'submitter_kind', s.submitter_kind)
      from public.submissions s where s.id = p.submission_id
    )
  )
  from public.properties p
  where p.id = p_property_id;
$$;

revoke execute on function public.property_detail(uuid) from public, anon, authenticated;
grant execute on function public.property_detail(uuid) to service_role;

create or replace function public.list_properties(
  p_limit integer,
  p_states public.editorial_state[] default null,
  p_market text default null,
  p_after_updated_at timestamptz default null,
  p_after_id uuid default null
)
returns table (
  id uuid,
  slug text,
  title text,
  market_slug text,
  region_slug text,
  editorial_state public.editorial_state,
  campaign_tier public.campaign_tier,
  hero_rank integer,
  featured_rank integer,
  published_at timestamptz,
  source public.submission_source,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  -- Screen 7 (B7 invariant 17c): one keyset page, last edited first, on properties_list_idx.
  select p.id, p.slug, p.title, p.market_slug, p.region_slug, p.editorial_state, p.campaign_tier, p.hero_rank,
    p.featured_rank, p.published_at, p.source, p.updated_at
  from public.properties p
  where (p_states is null or p.editorial_state = any (p_states))
    and (p_market is null or p.market_slug = p_market)
    and (
      p_after_updated_at is null
      or p.updated_at < p_after_updated_at
      or (p.updated_at = p_after_updated_at and p.id > p_after_id)
    )
  order by p.updated_at desc, p.id
  limit least(greatest(p_limit, 1), 51);
$$;

revoke execute on function public.list_properties(integer, public.editorial_state[], text, timestamptz, uuid)
  from public, anon, authenticated;
grant execute on function public.list_properties(integer, public.editorial_state[], text, timestamptz, uuid)
  to service_role;

create or replace function public.list_representatives(
  p_limit integer,
  p_search text default null,
  p_after_name text default null,
  p_after_id uuid default null
)
returns table (
  id uuid,
  name text,
  brokerage text,
  license text,
  email text,
  phone text
)
language sql
stable
security definer
set search_path = ''
as $$
  -- The Representation tab's search (B7 invariant 17c): one keyset page in name order on representatives_name_idx.
  -- The search is a parameter matched as plain text, never part of the query text (R44).
  select r.id, r.name, r.brokerage, r.license, r.email, r.phone
  from public.representatives r
  where (
      p_search is null
      or strpos(lower(r.name), lower(p_search)) > 0
      or strpos(lower(r.brokerage), lower(p_search)) > 0
    )
    and (p_after_name is null or (lower(r.name), r.id) > (lower(p_after_name), p_after_id))
  order by lower(r.name), r.id
  limit least(greatest(p_limit, 1), 51);
$$;

revoke execute on function public.list_representatives(integer, text, text, uuid) from public, anon, authenticated;
grant execute on function public.list_representatives(integer, text, text, uuid) to service_role;
