create or replace function public.retry_social_post(
  p_id uuid,
  p_force boolean,
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_request_id text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post public.social_posts;
  v_asset public.assets;
  v_tier public.campaign_tier;
  v_market text;
  v_type text;
  v_job uuid;
begin
  select * into v_post from public.social_posts p where p.id = p_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_post.status <> 'failed' then
    raise exception 'wrong_state' using errcode = '55000';
  end if;
  v_type := case v_post.channel
    when 'instagram' then 'post_meta'
    when 'facebook' then 'post_meta'
    when 'x' then 'post_x'
    when 'linkedin' then 'post_linkedin'
  end;
  if v_type is null then
    raise exception 'no_adapter' using errcode = '22023';
  end if;
  select * into v_asset from public.assets a where a.id = v_post.asset_id;
  select p.campaign_tier, p.market_slug into v_tier, v_market from public.properties p where p.id = v_asset.property_id;

  -- A retry clears the error, the in-flight marker included; `force` skips the revision check (invariant 2).
  update public.social_posts set status = 'scheduled', error = null where id = p_id;
  v_job := public.enqueue_job_manual(
    v_type, p_id,
    jsonb_build_object(
      'params', case
        when v_type = 'post_meta' then jsonb_build_object('channels', jsonb_build_array(v_post.channel))
        else '{}'::jsonb
      end,
      'data', jsonb_build_object(
        'asset_id', v_asset.id, 'property_id', v_asset.property_id, 'kind', v_asset.kind, 'tier', v_tier,
        'market', v_market, 'force', p_force
      )
    ),
    12
  );
  -- DB-09: no job means no retry, so the state change and the audit row roll back with this raise.
  if v_job is null then
    raise exception 'enqueue_failed' using errcode = '55000';
  end if;
  perform public.write_audit(
    p_actor, p_actor_kind, 'channels.retry', 'social_posts', p_id,
    jsonb_build_object('status', v_post.status, 'error', v_post.error),
    jsonb_build_object('status', 'scheduled', 'error', null),
    p_request_id, format('force: %s', p_force)
  );
  return v_job;
end;
$$;

revoke execute on function public.retry_social_post(uuid, boolean, uuid, public.actor_kind, text)
  from public, anon, authenticated;
grant execute on function public.retry_social_post(uuid, boolean, uuid, public.actor_kind, text) to service_role;
