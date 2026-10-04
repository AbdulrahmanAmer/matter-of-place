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
