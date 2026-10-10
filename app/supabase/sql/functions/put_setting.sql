create or replace function public.put_setting(
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
  -- The audit action of each key this function may write. 'invoice' is B6's settings_put_invoice, 'site' B16's
  -- settings_put_site and 'flags' B8b's (G26). Of these three keys only coming_soon_global is public: B2's settings
  -- trigger bumps catalog_version for it in this transaction (G21).
  v_action text := case p_key
    when 'coming_soon_global' then 'settings.coming_soon_put'
    when 'notifications' then 'settings.notifications_put'
    when 'agent_daily_limits' then 'team.limits_put'
  end;
  -- coming_soon_global is a bare boolean, as B2 seeds it and public_state reads it; the other two are objects. A case
  -- inside the if below would end its condition at the first then (G-903).
  v_type text := case p_key when 'coming_soon_global' then 'boolean' else 'object' end;
  v_before jsonb;
begin
  if v_action is null then
    raise exception 'invalid_key';
  end if;
  if jsonb_typeof(p_value) is distinct from v_type then
    raise exception 'validation' using errcode = '22023';
  end if;
  select s.value into v_before from public.settings s where s.key = p_key for update;
  insert into public.settings (key, value) values (p_key, p_value)
  on conflict (key) do update set value = excluded.value;
  perform public.write_audit(
    p_actor, p_actor_kind, v_action, 'settings.' || p_key, null, v_before, p_value, p_request_id
  );
  return p_value;
end;
$$;

revoke execute on function public.put_setting(text, jsonb, uuid, public.actor_kind, text)
  from public, anon, authenticated;
grant execute on function public.put_setting(text, jsonb, uuid, public.actor_kind, text) to service_role;
