-- down:
--   drop function public.set_market_coming_soon(text, boolean, uuid, public.actor_kind, text, boolean),
--     public.update_market(text, jsonb, jsonb, jsonb, jsonb, uuid, public.actor_kind, text, text);
set lock_timeout = '5s';

create or replace function public.update_market(
  p_slug text,
  p_patch jsonb,
  p_regions jsonb,
  p_notes jsonb,
  p_guide_entries jsonb,
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_request_id text,
  p_image_staging_path text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- The market columns an editor writes. `image` and `image_variants` are written by B9's render alone (G55), and
  -- `coming_soon` by set_market_coming_soon.
  v_fields constant text[] := array['name', 'intro', 'places', 'interest_copy', 'sort_order'];
  v_region_keys constant text[] := array['slug', 'name', 'intro', 'places', 'sort_order', 'image_staging_path'];
  v_region_required constant text[] := array['slug', 'name', 'intro', 'places', 'sort_order'];
  v_note_keys constant text[] := array['label', 'text'];
  v_guide_keys constant text[] := array['section', 'region_slug', 'label', 'text'];
  v_sections constant text[] := array['neighborhood', 'need', 'service'];
  v_old public.markets;
  v_new public.markets;
  v_item jsonb;
  v_before jsonb;
  v_after jsonb;
  v_path text;
begin
  -- B7 step 13, screen 15: one transaction for the market, its regions, notes and guide entries. A part passed as null
  -- is left as it is; a notes or guide list replaces the stored rows, in array order.
  select * into v_old from public.markets m where m.slug = p_slug for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if p_patch is null or jsonb_typeof(p_patch) <> 'object'
    or exists (select 1 from jsonb_object_keys(p_patch) k where k <> all (v_fields)) then
    raise exception 'invalid_key';
  end if;

  if p_regions is not null then
    if jsonb_typeof(p_regions) <> 'array' then
      raise exception 'invalid_key';
    end if;
    for v_item in select e.value from jsonb_array_elements(p_regions) e loop
      if jsonb_typeof(v_item) <> 'object' then
        raise exception 'invalid_key';
      end if;
      if exists (select 1 from jsonb_object_keys(v_item) k where k <> all (v_region_keys))
        or exists (select 1 from unnest(v_region_required) k where coalesce(jsonb_typeof(v_item -> k), 'null') = 'null') then
        raise exception 'invalid_key';
      end if;
    end loop;
    -- One slug twice would make the single upsert below touch a row twice.
    if (select count(distinct e.value ->> 'slug') from jsonb_array_elements(p_regions) e) <> jsonb_array_length(p_regions) then
      raise exception 'invalid_key';
    end if;
  end if;

  if p_notes is not null then
    if jsonb_typeof(p_notes) <> 'array' then
      raise exception 'invalid_key';
    end if;
    for v_item in select e.value from jsonb_array_elements(p_notes) e loop
      if jsonb_typeof(v_item) <> 'object' then
        raise exception 'invalid_key';
      end if;
      if exists (select 1 from jsonb_object_keys(v_item) k where k <> all (v_note_keys))
        or exists (select 1 from unnest(v_note_keys) k where btrim(coalesce(v_item ->> k, '')) = '') then
        raise exception 'invalid_key';
      end if;
    end loop;
  end if;

  if p_guide_entries is not null then
    if jsonb_typeof(p_guide_entries) <> 'array' then
      raise exception 'invalid_key';
    end if;
    for v_item in select e.value from jsonb_array_elements(p_guide_entries) e loop
      if jsonb_typeof(v_item) <> 'object' then
        raise exception 'invalid_key';
      end if;
      if exists (select 1 from jsonb_object_keys(v_item) k where k <> all (v_guide_keys))
        or (v_item ->> 'section') is null or (v_item ->> 'section') <> all (v_sections)
        or btrim(coalesce(v_item ->> 'label', '')) = '' or btrim(coalesce(v_item ->> 'text', '')) = '' then
        raise exception 'invalid_key';
      end if;
    end loop;
  end if;

  -- What the audit row records: the market row, and the parts this call replaces (the others are left out of both
  -- sides, so write_audit drops them from the diff).
  select to_jsonb(m)
    || case when p_regions is null then '{}'::jsonb else jsonb_build_object('regions', (
      select coalesce(jsonb_agg(jsonb_build_object('slug', r.slug, 'name', r.name, 'intro', r.intro, 'places', r.places,
        'sort_order', r.sort_order) order by r.sort_order, r.slug), '[]'::jsonb)
      from public.regions r where r.market_slug = p_slug)) end
    || case when p_notes is null then '{}'::jsonb else jsonb_build_object('notes', (
      select coalesce(jsonb_agg(jsonb_build_object('label', n.label, 'text', n.text) order by n.sort_order, n.id), '[]'::jsonb)
      from public.market_notes n where n.market_slug = p_slug)) end
    || case when p_guide_entries is null then '{}'::jsonb else jsonb_build_object('guide_entries', (
      select coalesce(jsonb_agg(jsonb_build_object('section', g.section, 'region_slug', g.region_slug, 'label', g.label,
        'text', g.text) order by g.sort_order, g.id), '[]'::jsonb)
      from public.market_guide_entries g where g.market_slug = p_slug)) end
  into v_before
  from public.markets m where m.slug = p_slug;

  -- A call that changes no market column leaves the markets table alone, so it raises catalog_version through the
  -- other tables it writes and not through this one.
  v_new := v_old;
  if p_patch <> '{}'::jsonb then
    v_new := jsonb_populate_record(v_old, p_patch);
    update public.markets m
    set name = v_new.name,
      intro = v_new.intro,
      places = v_new.places,
      interest_copy = v_new.interest_copy,
      sort_order = v_new.sort_order
    where m.slug = p_slug
    returning * into v_new;
  end if;

  if p_regions is not null and jsonb_array_length(p_regions) > 0 then
    -- A region belongs to one market: a slug that another market holds is refused, not taken over.
    if exists (
      select 1 from public.regions r
      join jsonb_array_elements(p_regions) e on r.slug = e.value ->> 'slug'
      where r.market_slug <> p_slug
    ) then
      raise exception 'invalid_key';
    end if;
    insert into public.regions (slug, market_slug, name, intro, places, sort_order)
    select e.value ->> 'slug', p_slug, e.value ->> 'name', e.value ->> 'intro',
      array(select jsonb_array_elements_text(e.value -> 'places')), (e.value ->> 'sort_order')::int
    from jsonb_array_elements(p_regions) e
    on conflict (slug) do update
    set name = excluded.name, intro = excluded.intro, places = excluded.places, sort_order = excluded.sort_order;

    -- G51: each staged region image is queued in this transaction; the region keeps its image until onResult.
    for v_item in select e.value from jsonb_array_elements(p_regions) e loop
      v_path := v_item ->> 'image_staging_path';
      if v_path is not null then
        if left(v_path, length('staging/region/' || (v_item ->> 'slug') || '/')) <> 'staging/region/' || (v_item ->> 'slug') || '/' then
          raise exception 'invalid_key';
        end if;
        perform public.enqueue_job(
          'render_variants',
          jsonb_build_object(
            'params', '{}'::jsonb,
            'data', jsonb_build_object('target', 'region', 'slug', v_item ->> 'slug', 'staging_path', v_path)
          ),
          'render_variants:region:' || (v_item ->> 'slug') || ':' || v_path,
          p_heavy => true
        );
      end if;
    end loop;
  end if;

  if p_notes is not null then
    delete from public.market_notes n where n.market_slug = p_slug;
    insert into public.market_notes (market_slug, label, text, sort_order)
    select p_slug, e.value ->> 'label', e.value ->> 'text', (e.ordinality - 1)::int
    from jsonb_array_elements(p_notes) with ordinality as e (value, ordinality);
  end if;

  if p_guide_entries is not null then
    -- A guide entry may name a region of this market, including one this call just added.
    if exists (
      select 1 from jsonb_array_elements(p_guide_entries) e
      where (e.value ->> 'region_slug') is not null
        and not exists (
          select 1 from public.regions r where r.slug = e.value ->> 'region_slug' and r.market_slug = p_slug
        )
    ) then
      raise exception 'invalid_key';
    end if;
    delete from public.market_guide_entries g where g.market_slug = p_slug;
    insert into public.market_guide_entries (market_slug, section, region_slug, label, text, sort_order)
    select p_slug, e.value ->> 'section', e.value ->> 'region_slug', e.value ->> 'label', e.value ->> 'text',
      (e.ordinality - 1)::int
    from jsonb_array_elements(p_guide_entries) with ordinality as e (value, ordinality);
  end if;

  -- G51: the staged market image, queued in the same transaction; the market keeps its image until onResult.
  if p_image_staging_path is not null then
    if left(p_image_staging_path, length('staging/market/' || p_slug || '/')) <> 'staging/market/' || p_slug || '/' then
      raise exception 'invalid_key';
    end if;
    perform public.enqueue_job(
      'render_variants',
      jsonb_build_object(
        'params', '{}'::jsonb,
        'data', jsonb_build_object('target', 'market', 'slug', p_slug, 'staging_path', p_image_staging_path)
      ),
      'render_variants:market:' || p_slug || ':' || p_image_staging_path,
      p_heavy => true
    );
  end if;

  select to_jsonb(m)
    || case when p_regions is null then '{}'::jsonb else jsonb_build_object('regions', (
      select coalesce(jsonb_agg(jsonb_build_object('slug', r.slug, 'name', r.name, 'intro', r.intro, 'places', r.places,
        'sort_order', r.sort_order) order by r.sort_order, r.slug), '[]'::jsonb)
      from public.regions r where r.market_slug = p_slug)) end
    || case when p_notes is null then '{}'::jsonb else jsonb_build_object('notes', (
      select coalesce(jsonb_agg(jsonb_build_object('label', n.label, 'text', n.text) order by n.sort_order, n.id), '[]'::jsonb)
      from public.market_notes n where n.market_slug = p_slug)) end
    || case when p_guide_entries is null then '{}'::jsonb else jsonb_build_object('guide_entries', (
      select coalesce(jsonb_agg(jsonb_build_object('section', g.section, 'region_slug', g.region_slug, 'label', g.label,
        'text', g.text) order by g.sort_order, g.id), '[]'::jsonb)
      from public.market_guide_entries g where g.market_slug = p_slug)) end
  into v_after
  from public.markets m where m.slug = p_slug;

  -- The market has no id: its slug names the entity (write_audit's contract for an entity without a uuid).
  perform public.write_audit(
    p_actor, p_actor_kind, 'markets.edit', 'markets.' || p_slug, null, v_before, v_after, p_request_id
  );
  return jsonb_build_object('slug', p_slug, 'updated_at', v_new.updated_at);
end;
$$;

revoke execute on function public.update_market(text, jsonb, jsonb, jsonb, jsonb, uuid, public.actor_kind, text, text)
  from public, anon, authenticated;
grant execute on function public.update_market(text, jsonb, jsonb, jsonb, jsonb, uuid, public.actor_kind, text, text)
  to service_role;

create or replace function public.set_market_coming_soon(
  p_slug text,
  p_coming_soon boolean,
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_request_id text,
  p_notify boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.markets;
  v_new public.markets;
begin
  -- B7 step 13, screen 15. The row is locked, so two editors who press the toggle at once do not both open the market.
  select * into v_old from public.markets m where m.slug = p_slug for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if p_coming_soon is null then
    raise exception 'invalid_key';
  end if;
  -- Already in the state asked for: nothing changes, nothing is audited and the catalog version stays.
  if v_old.coming_soon = p_coming_soon then
    return jsonb_build_object('slug', p_slug, 'coming_soon', v_old.coming_soon, 'updated_at', v_old.updated_at);
  end if;

  -- One update, so B2's trigger on markets raises catalog_version once (F25 a).
  update public.markets m set coming_soon = p_coming_soon where m.slug = p_slug returning * into v_new;

  -- G15, G37, G58: the interest-only signups of a market opened by hand get their one mail. The key
  -- `market_open:<market>` is the one B8b's open_market_on_publish uses, so opening again later (or through a
  -- publication) finds it taken and sends nothing twice. p_notify is false until the job type has a handler (G37).
  if p_notify and not p_coming_soon then
    perform public.enqueue_job(
      'market_open_notice',
      jsonb_build_object('params', '{}'::jsonb, 'data', jsonb_build_object('market', p_slug)),
      'market_open:' || p_slug,
      p_max_attempts => 12
    );
  end if;

  perform public.write_audit(
    p_actor, p_actor_kind, 'markets.coming_soon', 'markets.' || p_slug, null,
    jsonb_build_object('coming_soon', v_old.coming_soon), jsonb_build_object('coming_soon', v_new.coming_soon),
    p_request_id
  );
  return jsonb_build_object('slug', p_slug, 'coming_soon', v_new.coming_soon, 'updated_at', v_new.updated_at);
end;
$$;

revoke execute on function public.set_market_coming_soon(text, boolean, uuid, public.actor_kind, text, boolean)
  from public, anon, authenticated;
grant execute on function public.set_market_coming_soon(text, boolean, uuid, public.actor_kind, text, boolean)
  to service_role;
