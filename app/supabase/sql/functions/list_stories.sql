create or replace function public.list_stories(
  p_limit integer,
  p_state public.editorial_state default null,
  p_after_updated_at timestamptz default null,
  p_after_id uuid default null
)
returns table (
  id uuid,
  slug text,
  title text,
  category public.story_category,
  market_slug text,
  editorial_state public.editorial_state,
  image text,
  published_at timestamptz,
  updated_at timestamptz
)
language sql
stable
set search_path = ''
as $$
  -- Screen 14 (invariant 17c): one keyset page, last edited first, ordered as the list index `stories_list_idx` is.
  select s.id, s.slug, s.title, s.category, s.market_slug, s.editorial_state, s.image, s.published_at, s.updated_at
  from public.stories s
  where (p_state is null or s.editorial_state = p_state)
    and (
      p_after_updated_at is null
      or s.updated_at < p_after_updated_at
      or (s.updated_at = p_after_updated_at and s.id > p_after_id)
    )
  order by s.updated_at desc, s.id
  limit least(greatest(p_limit, 1), 51);
$$;

revoke execute on function public.list_stories(integer, public.editorial_state, timestamptz, uuid)
  from public, anon, authenticated;
grant execute on function public.list_stories(integer, public.editorial_state, timestamptz, uuid) to service_role;
