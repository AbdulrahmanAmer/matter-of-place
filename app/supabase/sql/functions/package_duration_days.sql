create or replace function public.package_duration_days(p_product public.exposure_package)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  -- B6 invariant 13 (DL-09): the one reader of `settings.invoice.campaign_days`; null means the campaign completes
  -- 30 days after publication.
  select (s.value -> 'campaign_days' ->> p_product::text)::integer
  from public.settings s
  where s.key = 'invoice';
$$;

revoke execute on function public.package_duration_days(public.exposure_package) from public, anon, authenticated;
grant execute on function public.package_duration_days(public.exposure_package) to service_role;
