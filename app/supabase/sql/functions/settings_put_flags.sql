create or replace function public.settings_put_flags(
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
  v_before jsonb;
  v_after jsonb;
begin
  -- Invariant 14: the closed set of names is checked in TS (`flagsPutSchema`); here every value is a boolean.
  if jsonb_typeof(p_value) is distinct from 'object'
    or exists (select 1 from jsonb_each(p_value) e where jsonb_typeof(e.value) <> 'boolean') then
    raise exception 'validation' using errcode = '22023';
  end if;
  select s.value into v_before from public.settings s where s.key = 'flags' for update;
  -- A flag the request leaves out keeps its stored value.
  v_after := coalesce(v_before, '{}'::jsonb) || p_value;
  -- B2's trigger on settings bumps catalog_version in this same transaction (F25 a).
  insert into public.settings (key, value) values ('flags', v_after)
  on conflict (key) do update set value = excluded.value;
  perform public.write_audit(
    p_actor, p_actor_kind, 'automation.flags_put', 'settings.flags', null, v_before, v_after, p_request_id
  );
  return v_after;
end;
$$;

revoke execute on function public.settings_put_flags(jsonb, uuid, public.actor_kind, text)
  from public, anon, authenticated;
grant execute on function public.settings_put_flags(jsonb, uuid, public.actor_kind, text) to service_role;
