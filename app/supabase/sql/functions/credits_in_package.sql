create or replace function public.credits_in_package(p_product public.exposure_package)
returns integer
language sql
immutable
set search_path = ''
as $$
  -- W6 item 8 (ruling H137): how many properties a package pays for in advance; mirrored by `creditsInPackage` in
  -- `src/domain/credits.ts`. Only Five Features is a pack: the other products are one property each and buy no credit.
  select case p_product::text when 'Five Features' then 5 end;
$$;

revoke execute on function public.credits_in_package(public.exposure_package) from public, anon, authenticated;
grant execute on function public.credits_in_package(public.exposure_package) to service_role;
