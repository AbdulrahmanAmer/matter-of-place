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
  -- The audit action of each key this function may write; step 15 adds its settings keys here.
  v_action text := case p_key when 'agent_daily_limits' then 'team.limits_put' end;
  v_before jsonb;
begin
  if v_action is null then
    raise exception 'invalid_key';
  end if;
  if jsonb_typeof(p_value) is distinct from 'object' then
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
