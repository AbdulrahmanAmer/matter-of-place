create or replace function public.record_channel_check(
  p_channel text,
  p_expires_at timestamptz,
  p_checked_at timestamptz,
  p_state text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_patch jsonb;
begin
  if p_channel not in ('x', 'linkedin') or p_state not in ('ok', 'dead', 'version_expired') then
    raise exception 'validation' using errcode = '22023';
  end if;
  -- Every other key of the channel's settings stays (ids, usage); only `ok` moves the expiry and the check time.
  v_patch := jsonb_build_object('token_state', p_state) || case
    when p_state = 'ok' then jsonb_build_object('token_expires_at', p_expires_at, 'token_checked_at', p_checked_at)
    else '{}'::jsonb
  end;
  insert into public.settings as s (key, value)
  values (p_channel, v_patch)
  on conflict (key) do update set value = s.value || v_patch;
end;
$$;

revoke execute on function public.record_channel_check(text, timestamptz, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.record_channel_check(text, timestamptz, timestamptz, text) to service_role;
