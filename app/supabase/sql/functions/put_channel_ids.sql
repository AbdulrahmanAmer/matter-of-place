create or replace function public.put_channel_ids(
  p_key text,
  p_value jsonb,
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
  v_allowed text[];
  v_before jsonb;
  v_after jsonb;
begin
  -- G21: the non-secret ids of a channel. Only the fields of channelIdsSchema pass, so no token reaches settings;
  -- these keys are not public, so catalog_version does not move.
  v_allowed := case p_key
    when 'meta' then array['page_id', 'ig_user_id', 'graph_version']
    when 'x' then array['user_id', 'handle', 'read_allowance', 'metrics_days']
    when 'linkedin' then array['organization_urn', 'api_version', 'multi_image']
  end;
  if v_allowed is null or jsonb_typeof(p_value) is distinct from 'object' then
    raise exception 'validation' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_object_keys(p_value) k where k <> all (v_allowed)) then
    raise exception 'unknown_field' using errcode = '22023';
  end if;
  select s.value into v_before from public.settings s where s.key = p_key for update;
  insert into public.settings as s (key, value, updated_by)
  values (p_key, p_value, p_actor)
  on conflict (key) do update set value = s.value || excluded.value, updated_by = excluded.updated_by
  returning value into v_after;
  perform public.write_audit(
    p_actor, p_actor_kind, 'channels.ids_put', 'settings', null, coalesce(v_before, '{}'::jsonb), v_after,
    p_request_id, case when p_actor is null then 'system' end
  );
  return v_after;
end;
$$;

revoke execute on function public.put_channel_ids(text, jsonb, uuid, public.actor_kind, text)
  from public, anon, authenticated;
grant execute on function public.put_channel_ids(text, jsonb, uuid, public.actor_kind, text) to service_role;
