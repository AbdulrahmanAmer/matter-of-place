-- down: re-run bun run db:fn approve_asset reject_asset from the previous commit of supabase/sql/functions/approve_asset.sql, supabase/sql/functions/reject_asset.sql
set lock_timeout = '5s';

create or replace function public.approve_asset(
  p_asset uuid,
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_request_id text default null,
  p_evidence jsonb default null
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
  -- B10 invariant 4: an agent, or the system (a null actor and kind, G43), approves only with the evidence of
  -- mayApprove; that evidence is kept in the audit row's note.
  if p_actor_kind is distinct from 'human' and p_evidence is null then
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

  insert into public.audit_log (actor_id, actor_kind, action, entity, entity_id, before, after, request_id, note)
  values (
    p_actor, p_actor_kind, 'assets.approve', 'assets', p_asset,
    jsonb_build_object('status', v_asset.status), jsonb_build_object('status', 'approved'), p_request_id,
    p_evidence::text
  );
  -- W7 item 19 (H107): a reel about a market, a story or the brand has no property; its subject and own market go out.
  return public.emit_event(
    'asset.approved', 'asset', p_asset,
    jsonb_build_object(
      'asset_id', p_asset, 'subject', v_asset.subject, 'property_id', v_asset.property_id, 'kind', v_asset.kind,
      'tier', v_tier, 'market', coalesce(v_market, v_asset.market_slug)
    ),
    p_actor
  );
end;
$$;

revoke execute on function public.approve_asset(uuid, uuid, public.actor_kind, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.approve_asset(uuid, uuid, public.actor_kind, text, jsonb) to service_role;

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
