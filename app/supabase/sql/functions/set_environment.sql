create or replace function public.set_environment(p_value text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb;
begin
  if p_value is null or p_value not in ('development', 'preview', 'production') then
    raise exception 'invalid_environment';
  end if;

  -- The row is held before the check, so an illustrative insert either commits first and is seen here, or waits in
  -- refuse_illustrative_in_production and then reads production.
  select s.value into v_before from public.settings s where s.key = 'environment' for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if p_value = 'production' and exists (select 1 from public.properties p where p.status = 'Illustrative') then
    raise exception 'illustrative_in_production';
  end if;

  -- The version bump is B2's trigger on settings, in this same transaction (`environment` is a public key).
  update public.settings set value = to_jsonb(p_value) where key = 'environment';

  -- A system write (G43): no actor, no actor kind.
  insert into public.audit_log (actor_id, actor_kind, action, entity, entity_id, before, after, note)
  values (null, null, 'settings.environment_set', 'settings.environment', null, v_before, to_jsonb(p_value), 'system');
end;
$$;

revoke execute on function public.set_environment(text) from public, anon, authenticated;
grant execute on function public.set_environment(text) to service_role;
