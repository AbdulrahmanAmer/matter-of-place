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
  return public.emit_event(
    'asset.approved', 'asset', p_asset,
    jsonb_build_object(
      'asset_id', p_asset, 'property_id', v_asset.property_id, 'kind', v_asset.kind, 'tier', v_tier, 'market', v_market
    ),
    p_actor
  );
end;
$$;

revoke execute on function public.approve_asset(uuid, uuid, public.actor_kind, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.approve_asset(uuid, uuid, public.actor_kind, text, jsonb) to service_role;
