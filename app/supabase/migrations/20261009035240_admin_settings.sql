-- down: re-run bun run db:fn put_setting from the previous commit of supabase/sql/functions/put_setting.sql, then
--   drop index public.audit_log_list_idx, public.audit_log_request_idx;
set lock_timeout = '5s';

-- B7 step 15. Screen 25 pages the audit log newest first on (at desc, id desc) and finds one request's rows by
-- request_id (invariant 17c); its actor and entity filters ride B2's audit_log_actor_idx and audit_log_entity_idx.
create index audit_log_list_idx on public.audit_log (at desc, id desc);
create index audit_log_request_idx on public.audit_log (request_id);

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
  v_before jsonb;
begin
  if v_action is null then
    raise exception 'invalid_key';
  end if;
  -- coming_soon_global is a bare boolean, as B2 seeds it and public_state reads it; the other two are objects.
  if jsonb_typeof(p_value) is distinct from case p_key when 'coming_soon_global' then 'boolean' else 'object' end then
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
