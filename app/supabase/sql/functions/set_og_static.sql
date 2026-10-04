create or replace function public.set_og_static(p_value jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  -- og_static is a public settings key, so B2's trigger bumps catalog_version (G21).
  insert into public.settings (key, value)
  values ('og_static', p_value)
  on conflict (key) do update set value = excluded.value, updated_at = now()
$$;

revoke execute on function public.set_og_static(jsonb) from public, anon, authenticated;
grant execute on function public.set_og_static(jsonb) to service_role;
