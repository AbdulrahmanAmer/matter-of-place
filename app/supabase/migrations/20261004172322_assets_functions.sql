-- down: re-run bun run db:fn assets_approve_guard assets_reject_note assets_job_error upsert_asset_stub claim_media_for_render set_asset_files set_asset_text apply_media_variants clear_media_staging set_target_image set_og_static approve_asset reject_asset rerender_asset set_asset_caption from the previous commit of supabase/sql/functions/assets_approve_guard.sql, supabase/sql/functions/assets_reject_note.sql, supabase/sql/functions/assets_job_error.sql, supabase/sql/functions/upsert_asset_stub.sql, supabase/sql/functions/claim_media_for_render.sql, supabase/sql/functions/set_asset_files.sql, supabase/sql/functions/set_asset_text.sql, supabase/sql/functions/apply_media_variants.sql, supabase/sql/functions/clear_media_staging.sql, supabase/sql/functions/set_target_image.sql, supabase/sql/functions/set_og_static.sql, supabase/sql/functions/approve_asset.sql, supabase/sql/functions/reject_asset.sql, supabase/sql/functions/rerender_asset.sql, supabase/sql/functions/set_asset_caption.sql
set lock_timeout = '5s';

create or replace function public.assets_approve_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_missing text;
begin
  -- B9 invariant 4: what each kind needs before a human may approve it. The first missing part names itself.
  if new.kind in ('cover', 'carousel', 'story', 'reel') then
    v_missing := case
      when jsonb_array_length(new.files) = 0 then 'files'
      when coalesce(btrim(new.caption), '') = '' then 'caption'
      when coalesce(btrim(new.alt_text), '') = '' then 'alt_text'
    end;
    if v_missing is null and new.meta ->> 'caption_lint' = 'failed' then
      raise exception 'caption_lint_failed' using errcode = '23514';
    end if;
  elsif new.kind = 'newsletter_block' then
    v_missing := case
      when coalesce(btrim(new.meta #>> '{block,title}'), '') = '' then 'meta.block.title'
      when coalesce(btrim(new.meta #>> '{block,deck}'), '') = '' then 'meta.block.deck'
      when coalesce(btrim(new.meta #>> '{block,image_key}'), '') = '' then 'meta.block.image_key'
      when coalesce(btrim(new.meta #>> '{block,image_url}'), '') = '' then 'meta.block.image_url'
      when coalesce(btrim(new.alt_text), '') = '' then 'alt_text'
    end;
  elsif new.kind = 'standalone_email' then
    v_missing := case
      when coalesce(btrim(new.meta ->> 'subject'), '') = '' then 'meta.subject'
      when coalesce(btrim(new.meta ->> 'preheader'), '') = '' then 'meta.preheader'
      when jsonb_typeof(new.meta -> 'block') is distinct from 'object' or new.meta -> 'block' = '{}'::jsonb
        then 'meta.block'
    end;
  else
    v_missing := 'kind';
  end if;
  if v_missing is not null then
    raise exception 'asset_incomplete' using errcode = '23514', detail = v_missing;
  end if;
  return new;
end;
$$;

revoke execute on function public.assets_approve_guard() from public, anon, authenticated;

create or replace trigger assets_approve_guard
before update on public.assets
for each row when (new.status = 'approved' and old.status is distinct from 'approved')
execute function public.assets_approve_guard();

create or replace function public.assets_reject_note()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(btrim(new.rejection_note), '') = '' then
    raise exception 'rejection_note_required' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke execute on function public.assets_reject_note() from public, anon, authenticated;

create or replace trigger assets_reject_note
before update on public.assets
for each row when (new.status = 'rejected' and old.status is distinct from 'rejected')
execute function public.assets_reject_note();

create or replace function public.assets_job_error()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- B9 invariant 11: a failed or dead job shows its error on the card of the asset it renders; a later set_asset_files
  -- clears it. Nothing here changes the jobs row.
  update public.assets set render_error = new.error where job_id = new.id;
  return null;
end;
$$;

revoke execute on function public.assets_job_error() from public, anon, authenticated;

create or replace trigger assets_job_error
after update of status on public.jobs
for each row when (new.status in ('failed', 'dead'))
execute function public.assets_job_error();

create or replace function public.upsert_asset_stub(
  p_property uuid,
  p_kind public.asset_kind,
  p_revision int default null,
  p_job_id uuid default null
)
returns public.assets
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_revision int := p_revision;
  v_row public.assets;
begin
  if v_revision is null then
    -- The current revision is the highest one not rejected. When every revision was rejected a new one starts, so a
    -- second publish after a rejection gets fresh creative instead of writing into a rejected row.
    select coalesce(max(a.revision) filter (where a.status <> 'rejected'), max(a.revision) + 1, 1)
    into v_revision
    from public.assets a
    where a.property_id = p_property and a.kind = p_kind;
  end if;

  -- The render steps and write_captions run at once; whichever comes first creates the row and the other finds it.
  insert into public.assets (property_id, kind, revision, job_id)
  values (p_property, p_kind, v_revision, p_job_id)
  on conflict (property_id, kind, revision) do nothing;

  select * into v_row
  from public.assets a
  where a.property_id = p_property and a.kind = p_kind and a.revision = v_revision;

  -- Only a pending row follows a new job: an approved asset keeps the job that made it (invariant 12).
  if p_job_id is not null and v_row.status = 'pending' and v_row.job_id is distinct from p_job_id then
    update public.assets set job_id = p_job_id where id = v_row.id returning * into v_row;
  end if;
  return v_row;
end;
$$;

revoke execute on function public.upsert_asset_stub(uuid, public.asset_kind, int, uuid)
  from public, anon, authenticated;
grant execute on function public.upsert_asset_stub(uuid, public.asset_kind, int, uuid) to service_role;

create or replace function public.claim_media_for_render(
  p_property_id uuid,
  p_job_id uuid,
  p_limit int default 40
)
returns setof public.property_media
language sql
security definer
set search_path = ''
as $$
  -- PERF-01: each staged row goes to exactly one render_variants job. A claim of a job that is no longer running lapses
  -- by itself, a retry reclaims its own rows, and skip locked keeps two concurrent claims disjoint.
  with claimed as (
    update public.property_media pm
    set render_job_id = p_job_id
    where pm.id in (
      select m.id
      from public.property_media m
      where m.property_id = p_property_id
        and m.staging_path is not null
        and (
          m.render_job_id is null
          or m.render_job_id = p_job_id
          or not exists (select 1 from public.jobs j where j.id = m.render_job_id and j.status = 'running')
        )
      order by m.sort_order
      limit p_limit
      for update skip locked
    )
    returning pm.*
  )
  select c.* from claimed c order by c.sort_order, c.id
$$;

revoke execute on function public.claim_media_for_render(uuid, uuid, int) from public, anon, authenticated;
grant execute on function public.claim_media_for_render(uuid, uuid, int) to service_role;

create or replace function public.set_asset_files(p_asset uuid, p_files jsonb, p_spec_hash text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The render onResult: files and the spec hash only, and a stored error is cleared (invariant 11). It never touches
  -- caption, alt_text or meta.captions, so the order of the concurrent steps does not matter.
  update public.assets
  set files = p_files,
    meta = meta || jsonb_build_object('spec_hash', p_spec_hash),
    render_error = null
  where id = p_asset;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
end;
$$;

revoke execute on function public.set_asset_files(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.set_asset_files(uuid, jsonb, text) to service_role;

create or replace function public.set_asset_text(
  p_asset uuid,
  p_caption text default null,
  p_alt_text text default null,
  p_meta jsonb default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_meta jsonb := coalesce(p_meta, '{}'::jsonb);
begin
  -- A null caption or alt text keeps the stored one. max_slides is written only while meta has none, so whichever of
  -- render_carousel and write_captions comes first sets the slide count both plan from.
  update public.assets
  set caption = coalesce(p_caption, caption),
    alt_text = coalesce(p_alt_text, alt_text),
    meta = meta || case when meta ? 'max_slides' then v_meta - 'max_slides' else v_meta end
  where id = p_asset;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
end;
$$;

revoke execute on function public.set_asset_text(uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.set_asset_text(uuid, text, text, jsonb) to service_role;

create or replace function public.apply_media_variants(p_items jsonb)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  -- JOB-03: one statement for every photograph of a callback. An item stores only while the row's staging_path still
  -- equals the path that was signed, so a replaced photograph keeps its new path for the next job. Orientation is not
  -- written here: property_media_orientation sets it from variants -> hero in this same update (G63).
  with items as (
    select e.ord,
      (e.item ->> 'media_id')::uuid as media_id,
      e.item ->> 'staging_path' as staging_path,
      e.item ->> 'media_key' as media_key,
      e.item -> 'variants' as variants
    from jsonb_array_elements(p_items) with ordinality as e(item, ord)
  ),
  stored as (
    update public.property_media m
    set media_key = i.media_key,
      -- The same stripped original rendered again keeps its other sizes; another photograph never inherits them.
      variants = case when m.media_key = i.media_key then m.variants || i.variants else i.variants end
    from items i
    where m.id = i.media_id and m.staging_path = i.staging_path
    returning m.id
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object('media_id', i.media_id, 'staging_path', i.staging_path, 'stored', s.id is not null)
      order by i.ord
    ),
    '[]'::jsonb
  )
  from items i
  left join stored s on s.id = i.media_id
$$;

revoke execute on function public.apply_media_variants(jsonb) from public, anon, authenticated;
grant execute on function public.apply_media_variants(jsonb) to service_role;

create or replace function public.clear_media_staging(p_items jsonb)
returns integer
language sql
security definer
set search_path = ''
as $$
  -- JOB-03: after apply_media_variants and the removal of the staged objects. The path match leaves a row whose
  -- staging_path changed meanwhile alone.
  with items as (
    select (e.item ->> 'media_id')::uuid as media_id, e.item ->> 'staging_path' as staging_path
    from jsonb_array_elements(p_items) as e(item)
  ),
  cleared as (
    update public.property_media m
    set staging_path = null, render_job_id = null
    from items i
    where m.id = i.media_id and m.staging_path = i.staging_path
    returning m.id
  )
  select count(*)::int from cleared
$$;

revoke execute on function public.clear_media_staging(jsonb) from public, anon, authenticated;
grant execute on function public.clear_media_staging(jsonb) to service_role;

create or replace function public.set_target_image(
  p_target text,
  p_slug text,
  p_image text,
  p_variants jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The render_variants target job (G42): the row's own image and sizes in one update; B2's triggers bump the version.
  if p_target = 'story' then
    update public.stories set image = p_image, image_variants = p_variants where slug = p_slug;
  elsif p_target = 'market' then
    update public.markets set image = p_image, image_variants = p_variants where slug = p_slug;
  elsif p_target = 'region' then
    update public.regions set image = p_image, image_variants = p_variants where slug = p_slug;
  else
    raise exception 'invalid_target' using errcode = '22023';
  end if;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
end;
$$;

revoke execute on function public.set_target_image(text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.set_target_image(text, text, text, jsonb) to service_role;

create or replace function public.set_og_static(p_value jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  -- og_static is a public settings key, so B2's trigger bumps catalog_version (G21).
  insert into public.settings (key, value)
  values ('og_static', p_value)
  on conflict (key) do update set value = excluded.value, updated_at = now()
$$;

revoke execute on function public.set_og_static(jsonb) from public, anon, authenticated;
grant execute on function public.set_og_static(jsonb) to service_role;

create or replace function public.approve_asset(
  p_asset uuid,
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_request_id text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asset public.assets;
  v_tier public.campaign_tier;
  v_market text;
begin
  -- Until B10 replaces this check with mayApprove, only a human approves.
  if p_actor_kind = 'agent' then
    raise exception 'manual_approval' using errcode = '42501';
  end if;
  select * into v_asset from public.assets a where a.id = p_asset for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_asset.status <> 'pending' then
    raise exception 'asset_not_pending' using errcode = '55000';
  end if;
  select p.campaign_tier, p.market_slug into v_tier, v_market
  from public.properties p
  where p.id = v_asset.property_id;

  -- The guard trigger assets_approve_guard runs here and refuses an incomplete asset.
  update public.assets set status = 'approved', approved_by = p_actor, approved_at = now() where id = p_asset;

  -- G6: an approved cover is the property's Open Graph image. A cover with no main file leaves the key as it is.
  if v_asset.kind = 'cover' then
    update public.properties p
    set og_image_key = coalesce(
      (select f ->> 'media_key' from jsonb_array_elements(v_asset.files) f where f ->> 'role' = 'main' limit 1),
      p.og_image_key
    )
    where p.id = v_asset.property_id;
  end if;

  insert into public.audit_log (actor_id, actor_kind, action, entity, entity_id, before, after, request_id)
  values (
    p_actor, p_actor_kind, 'assets.approve', 'assets', p_asset,
    jsonb_build_object('status', v_asset.status), jsonb_build_object('status', 'approved'), p_request_id
  );
  return public.emit_event(
    'asset.approved', 'asset', p_asset,
    jsonb_build_object(
      'asset_id', p_asset, 'property_id', v_asset.property_id, 'kind', v_asset.kind, 'tier', v_tier, 'market', v_market
    ),
    p_actor
  );
end;
$$;

revoke execute on function public.approve_asset(uuid, uuid, public.actor_kind, text)
  from public, anon, authenticated;
grant execute on function public.approve_asset(uuid, uuid, public.actor_kind, text) to service_role;

create or replace function public.reject_asset(
  p_asset uuid,
  p_note text,
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_request_id text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asset public.assets;
  v_tier public.campaign_tier;
  v_market text;
begin
  select * into v_asset from public.assets a where a.id = p_asset for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_asset.status not in ('pending', 'approved') then
    raise exception 'asset_not_rejectable' using errcode = '55000';
  end if;
  select p.campaign_tier, p.market_slug into v_tier, v_market
  from public.properties p
  where p.id = v_asset.property_id;

  -- The trigger assets_reject_note runs here and refuses a reject without a note. A reject never changes
  -- properties.og_image_key: the old key is immutable and stays served until the next approved cover replaces it.
  update public.assets set status = 'rejected', rejection_note = p_note where id = p_asset;

  insert into public.audit_log (actor_id, actor_kind, action, entity, entity_id, before, after, request_id, note)
  values (
    p_actor, p_actor_kind, 'assets.reject', 'assets', p_asset,
    jsonb_build_object('status', v_asset.status), jsonb_build_object('status', 'rejected'), p_request_id, p_note
  );
  return public.emit_event(
    'asset.rejected', 'asset', p_asset,
    jsonb_build_object(
      'asset_id', p_asset, 'property_id', v_asset.property_id, 'kind', v_asset.kind, 'tier', v_tier,
      'market', v_market, 'note', p_note
    ),
    p_actor
  );
end;
$$;

revoke execute on function public.reject_asset(uuid, text, uuid, public.actor_kind, text)
  from public, anon, authenticated;
grant execute on function public.reject_asset(uuid, text, uuid, public.actor_kind, text) to service_role;

create or replace function public.rerender_asset(
  p_asset uuid,
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_request_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asset public.assets;
  v_latest public.assets;
  v_new public.assets;
  v_property record;
  v_type text;
  v_key text;
  v_data jsonb;
  v_job uuid;
begin
  select * into v_asset from public.assets a where a.id = p_asset;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtext('assets:' || v_asset.property_id::text || ':' || v_asset.kind::text));
  select * into v_latest
  from public.assets a
  where a.property_id = v_asset.property_id and a.kind = v_asset.kind
  order by a.revision desc
  limit 1;

  -- A second call while the new revision is still pending answers with that revision and its job.
  if v_latest.revision > v_asset.revision and v_latest.status = 'pending' then
    return jsonb_build_object('asset_id', v_latest.id, 'job_id', v_latest.job_id);
  end if;

  -- B9 invariant 3: the kind names the job type; the render kinds are heavy, the newsletter kinds are light (G4).
  v_type := case v_asset.kind
    when 'cover' then 'render_cover'
    when 'carousel' then 'render_carousel'
    when 'story' then 'render_story'
    when 'reel' then 'render_reel'
    when 'newsletter_block' then 'build_newsletter_block'
    when 'standalone_email' then 'build_newsletter_block'
  end;
  if v_type is null then
    raise exception 'invalid_kind' using errcode = '22023';
  end if;
  select p.slug, p.campaign_tier, p.market_slug into v_property
  from public.properties p
  where p.id = v_asset.property_id;

  v_new := public.upsert_asset_stub(v_asset.property_id, v_asset.kind, v_latest.revision + 1, null);
  update public.assets
  set caption = v_latest.caption,
    alt_text = v_latest.alt_text,
    meta = jsonb_strip_nulls(jsonb_build_object(
      'captions', v_latest.meta -> 'captions',
      'slide_alts', v_latest.meta -> 'slide_alts',
      'max_slides', v_latest.meta -> 'max_slides',
      'caption_lint', v_latest.meta -> 'caption_lint'
    ))
  where id = v_new.id;
  update public.assets
  set status = 'rejected', rejection_note = 'superseded'
  where id = v_latest.id and status <> 'rejected';

  v_data := jsonb_build_object(
    'property_id', v_asset.property_id, 'slug', v_property.slug, 'tier', v_property.campaign_tier,
    'market', v_property.market_slug, 'revision', v_new.revision
  );
  if v_asset.kind in ('newsletter_block', 'standalone_email') then
    v_data := v_data || jsonb_build_object('kind', v_asset.kind);
    v_key := v_type || ':' || v_asset.property_id::text || ':' || v_asset.kind::text || ':' || v_new.revision::text;
  else
    v_key := v_type || ':' || v_asset.property_id::text || ':' || v_new.revision::text;
  end if;
  v_job := public.enqueue_job(
    v_type, jsonb_build_object('params', '{}'::jsonb, 'data', v_data), v_key,
    p_heavy => v_type <> 'build_newsletter_block'
  );
  if v_job is null then
    select j.id into v_job from public.jobs j where j.idempotency_key = v_key;
  end if;
  update public.assets set job_id = v_job where id = v_new.id;

  insert into public.audit_log (actor_id, actor_kind, action, entity, entity_id, before, after, request_id)
  values (
    p_actor, p_actor_kind, 'assets.re_render', 'assets', v_new.id,
    jsonb_build_object('asset_id', v_latest.id, 'revision', v_latest.revision),
    jsonb_build_object('asset_id', v_new.id, 'revision', v_new.revision, 'job_id', v_job),
    p_request_id
  );
  return jsonb_build_object('asset_id', v_new.id, 'job_id', v_job);
end;
$$;

revoke execute on function public.rerender_asset(uuid, uuid, public.actor_kind, text)
  from public, anon, authenticated;
grant execute on function public.rerender_asset(uuid, uuid, public.actor_kind, text) to service_role;

create or replace function public.set_asset_caption(
  p_asset uuid,
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_captions jsonb default null,
  p_alt_text text default null,
  p_request_id text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asset public.assets;
  v_job record;
begin
  select * into v_asset from public.assets a where a.id = p_asset for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  -- The caption column mirrors captions.instagram. The service has already linted every edited variant, and
  -- caption_lint = 'edited' tells write_captions never to overwrite what an editor typed (H34 (5)).
  update public.assets
  set caption = coalesce(p_captions ->> 'instagram', caption),
    alt_text = coalesce(p_alt_text, alt_text),
    meta = meta
      || jsonb_build_object('caption_lint', 'edited')
      || case
        when p_captions is null then '{}'::jsonb
        else jsonb_build_object('captions', coalesce(meta -> 'captions', '{}'::jsonb) || p_captions)
      end
  where id = p_asset;

  -- H34 (5): nothing downstream waits on the laptop. A queued write_captions job of this property is done; a running
  -- one is the runner's and stays running.
  for v_job in
    select j.id, j.attempts, j.heavy, j.msg_id
    from public.jobs j
    where j.type = 'write_captions'
      and j.status = 'queued'
      and j.payload -> 'data' ->> 'property_id' = v_asset.property_id::text
    for update
  loop
    if v_job.msg_id is not null then
      perform public.job_queue_delete(v_job.heavy, v_job.msg_id);
    end if;
    update public.jobs
    set status = 'done', result = '{"manual": true}'::jsonb, finished_at = now(), msg_id = null
    where id = v_job.id;
    insert into public.job_events (job_id, kind, from_status, to_status, attempt, actor_id)
    values (v_job.id, 'done', 'queued', 'done', v_job.attempts, p_actor);
  end loop;

  insert into public.audit_log (actor_id, actor_kind, action, entity, entity_id, request_id)
  values (p_actor, p_actor_kind, 'assets.caption', 'assets', p_asset, p_request_id);
end;
$$;

revoke execute on function public.set_asset_caption(uuid, uuid, public.actor_kind, jsonb, text, text)
  from public, anon, authenticated;
grant execute on function public.set_asset_caption(uuid, uuid, public.actor_kind, jsonb, text, text)
  to service_role;
