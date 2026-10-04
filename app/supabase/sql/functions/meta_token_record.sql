create or replace function public.meta_token_record(
  p_checked_at timestamptz,
  p_token_state text,
  p_missing_scopes text[],
  p_expires_at timestamptz default null,
  p_data_access_expires_at timestamptz default null,
  p_new_token text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- INT-06: what the daily check read about the Meta token, merged into settings.meta (an admin key, so no catalog
  -- bump, G21). A null expiry means never; the two dates come last with defaults, so a caller leaves a null one out.
  -- A refreshed token goes to Vault with its one secret.rotated row in the same transaction. Two runs never write at
  -- once: the second answers locked (G21).
  if p_token_state not in ('ok', 'dead', 'scopes_missing') then
    raise exception 'invalid_token_state';
  end if;
  if not pg_try_advisory_xact_lock(hashtext('meta_page_token')) then
    return 'locked';
  end if;
  update public.settings
  set value = value || jsonb_build_object(
    'token_expires_at', p_expires_at,
    'token_checked_at', p_checked_at,
    'token_state', p_token_state,
    'missing_scopes', to_jsonb(p_missing_scopes),
    'data_access_expires_at', p_data_access_expires_at
  )
  where key = 'meta';
  if p_new_token is not null then
    perform public.set_vault_secret('meta_page_token', p_new_token);
    insert into public.audit_log (action, entity, actor_id, actor_kind)
    values ('secret.rotated', 'META_PAGE_TOKEN', null, null);
  end if;
  return 'ok';
end;
$$;

revoke execute on function public.meta_token_record(timestamptz, text, text[], timestamptz, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.meta_token_record(timestamptz, text, text[], timestamptz, timestamptz, text)
  to service_role;
