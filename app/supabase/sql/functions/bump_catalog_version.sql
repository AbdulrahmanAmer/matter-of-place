create or replace function public.bump_catalog_version()
returns bigint
language sql
security definer
set search_path = ''
as $$
  update public.settings
  set value = to_jsonb((value #>> '{}')::bigint + 1)
  where key = 'catalog_version'
  returning (value #>> '{}')::bigint;
$$;
