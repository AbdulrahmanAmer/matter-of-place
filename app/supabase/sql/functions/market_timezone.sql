create or replace function public.market_timezone(p_market_slug text)
returns text
language sql
immutable
security definer
set search_path = ''
as $$
  -- B7 invariant 8 (DL-09): mirrors marketTimezone of src/domain/market-time.ts.
  select case when p_market_slug = 'california' then 'America/Los_Angeles' else 'America/New_York' end;
$$;

revoke execute on function public.market_timezone(text) from public, anon, authenticated;
grant execute on function public.market_timezone(text) to service_role;
