create or replace function public.apply_media_variants(p_items jsonb)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  -- JOB-03: one statement for every photograph of a callback. An item stores only while the row's staging_path still
  -- equals the path that was signed, so a replaced photograph keeps its new path for the next job. Orientation is not
  -- written here: property_media_orientation sets it from variants -> hero in this same update (G63).
  with items as (
    select e.ord,
      (e.item ->> 'media_id')::uuid as media_id,
      e.item ->> 'staging_path' as staging_path,
      e.item ->> 'media_key' as media_key,
      e.item -> 'variants' as variants
    from jsonb_array_elements(p_items) with ordinality as e(item, ord)
  ),
  stored as (
    update public.property_media m
    set media_key = i.media_key,
      -- The same stripped original rendered again keeps its other sizes; another photograph never inherits them.
      variants = case when m.media_key = i.media_key then m.variants || i.variants else i.variants end
    from items i
    where m.id = i.media_id and m.staging_path = i.staging_path
    returning m.id
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object('media_id', i.media_id, 'staging_path', i.staging_path, 'stored', s.id is not null)
      order by i.ord
    ),
    '[]'::jsonb
  )
  from items i
  left join stored s on s.id = i.media_id
$$;

revoke execute on function public.apply_media_variants(jsonb) from public, anon, authenticated;
grant execute on function public.apply_media_variants(jsonb) to service_role;
