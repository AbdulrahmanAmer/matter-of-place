create or replace function public.store_channel_token(
  p_channel text,
  p_used_refresh_sha256 text,
  p_token_set jsonb
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current text;
  v_name text;
begin
  if p_channel not in ('x', 'linkedin') then
    raise exception 'validation' using errcode = '22023';
  end if;
  -- G21: one writer per channel, the lock ends with the transaction; no lease table.
  if not pg_try_advisory_xact_lock(hashtext('token_refresh:' || p_channel)) then
    return 'busy';
  end if;
  -- A refresh token is used once: a set refreshed from another token than the one stored now is stale. An empty
  -- entry is the env seed, whose hash only the caller knows.
  v_current := public.get_vault_secret(p_channel || '_oauth_token');
  if coalesce(v_current, '') <> ''
    and encode(sha256(convert_to(coalesce(v_current::jsonb ->> 'refresh_token', ''), 'UTF8')), 'hex')
      is distinct from p_used_refresh_sha256 then
    return 'stale';
  end if;
  perform public.set_vault_secret(p_channel || '_oauth_token', p_token_set::text);
  v_name := case p_channel when 'x' then 'X_ACCESS_TOKEN' else 'LINKEDIN_ACCESS_TOKEN' end;
  insert into public.audit_log (actor_id, actor_kind, action, entity, note)
  values (null, null, 'secret.rotated', v_name, v_name || ': automatic refresh');
  return 'stored';
end;
$$;

revoke execute on function public.store_channel_token(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.store_channel_token(text, text, jsonb) to service_role;
