create or replace function public.list_properties(
  p_limit integer,
  p_states public.editorial_state[] default null,
  p_market text default null,
  p_after_updated_at timestamptz default null,
  p_after_id uuid default null
)
returns table (
  id uuid,
  slug text,
  title text,
  market_slug text,
  region_slug text,
  editorial_state public.editorial_state,
  campaign_tier public.campaign_tier,
  hero_rank integer,
  featured_rank integer,
  published_at timestamptz,
  source public.submission_source,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  -- Screen 7 (B7 invariant 17c): one keyset page, last edited first, on properties_list_idx.
  select p.id, p.slug, p.title, p.market_slug, p.region_slug, p.editorial_state, p.campaign_tier, p.hero_rank,
    p.featured_rank, p.published_at, p.source, p.updated_at
  from public.properties p
  where (p_states is null or p.editorial_state = any (p_states))
    and (p_market is null or p.market_slug = p_market)
    and (
      p_after_updated_at is null
      or p.updated_at < p_after_updated_at
      or (p.updated_at = p_after_updated_at and p.id > p_after_id)
    )
  order by p.updated_at desc, p.id
  limit least(greatest(p_limit, 1), 51);
$$;

revoke execute on function public.list_properties(integer, public.editorial_state[], text, timestamptz, uuid)
  from public, anon, authenticated;
grant execute on function public.list_properties(integer, public.editorial_state[], text, timestamptz, uuid)
  to service_role;
