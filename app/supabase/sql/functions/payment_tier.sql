create or replace function public.payment_tier(p_product public.exposure_package)
returns text
language sql
immutable
set search_path = ''
as $$
  -- B6 invariant 3: the `tier` of the payment events and `properties.campaign_tier`, mirrored by `tierOf` in
  -- `src/domain/payments.ts`. ASSUMED: a Five Features credit buys one Feature per property.
  select case p_product::text
    when 'The Feature' then 'Feature'
    when 'Five Features' then 'Feature'
    when 'The Reach' then 'Reach'
    when 'The Campaign' then 'Campaign'
  end;
$$;

revoke execute on function public.payment_tier(public.exposure_package) from public, anon, authenticated;
grant execute on function public.payment_tier(public.exposure_package) to service_role;
