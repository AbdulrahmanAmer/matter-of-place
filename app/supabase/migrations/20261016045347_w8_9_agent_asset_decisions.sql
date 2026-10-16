-- down: re-run bun run db:fn reject_asset rerender_asset from the previous commit of supabase/sql/functions/reject_asset.sql, supabase/sql/functions/rerender_asset.sql
set lock_timeout = '5s';

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
  -- W8 item 9: an agent key (Matter's) rejects only an asset still waiting for a decision; an approved one stays a
  -- person's to take back.
  if p_actor_kind = 'agent' and v_asset.status <> 'pending' then
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
  -- W7 item 19 (H107): a reel about a market, a story or the brand has no property; its subject and own market go out.
  return public.emit_event(
    'asset.rejected', 'asset', p_asset,
    jsonb_build_object(
      'asset_id', p_asset, 'subject', v_asset.subject, 'property_id', v_asset.property_id, 'kind', v_asset.kind,
      'tier', v_tier, 'market', coalesce(v_market, v_asset.market_slug), 'note', p_note
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
  -- W7 item 19 (H107): a reel about a market, a story or the brand is never re-rendered; a new request is the path.
  if v_asset.subject <> 'property' then
    raise exception 'requested_asset' using errcode = '22023';
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
  -- W8 item 9: an agent key's re-render supersedes only a revision still waiting or already rejected, never an
  -- approved or published one (that would take it back); a person rejects that first.
  if p_actor_kind = 'agent' and v_latest.status not in ('pending', 'rejected') then
    raise exception 'asset_not_rejectable' using errcode = '55000';
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
