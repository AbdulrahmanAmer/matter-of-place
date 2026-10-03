create or replace function public.tg_bump_catalog_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.bump_catalog_version();
  return null;
end;
$$;
