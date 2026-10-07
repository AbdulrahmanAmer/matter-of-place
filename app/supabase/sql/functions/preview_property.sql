create or replace function public.preview_property(p_property_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  -- B7 invariant 17 (f): the one public read of a row in any editorial state, called only by
  -- src/server/previews/service.ts after the token's signature and expiry pass. `property` has the shape of
  -- public_catalog_snapshot's property object; a draft is shown as if it were published now. Null when no row.
  select jsonb_build_object(
    'preview_nonce', p.preview_nonce,
    'representative', (select to_jsonb(r) from public.representatives r where r.id = p.representative_id),
    'property', jsonb_build_object(
      'id', p.id,
      'slug', p.slug,
      'title', p.title,
      'market_slug', p.market_slug,
      'region_slug', p.region_slug,
      'city', p.city,
      'neighborhood', p.neighborhood,
      'state', p.state,
      'country', p.country,
      'address', p.address,
      'coordinates', case when p.coordinates is not null then jsonb_build_array(p.coordinates[0], p.coordinates[1]) end,
      'price', p.price,
      'currency', p.currency,
      'beds', p.beds,
      'baths', p.baths,
      'interior_sq_ft', p.interior_sq_ft,
      'lot_acres', p.lot_acres,
      'year_built', p.year_built,
      'type', p.type,
      'style', p.style,
      'architect', p.architect,
      'designer', p.designer,
      'status', p.status,
      'hero_image', p.hero_image,
      'video', p.video,
      'og_image_key', p.og_image_key,
      'story', p.story,
      'place', p.place,
      'representative_id', p.representative_id,
      'presented_by_owner', p.presented_by_owner,
      'listing_url', p.listing_url,
      'hero_rank', p.hero_rank,
      'featured_rank', p.featured_rank,
      'published_at', coalesce(p.published_at, now()),
      'updated_at', p.updated_at,
      'media', coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id', m.id,
              'media_key', m.media_key,
              'variants', m.variants,
              'alt', m.alt,
              'orientation', m.orientation,
              'sort_order', m.sort_order
            )
            order by m.sort_order, m.id
          )
          from public.property_media m
          where m.property_id = p.id and m.media_key is not null
        ),
        '[]'::jsonb
      ),
      'features', coalesce(
        (
          select jsonb_agg(f.feature order by f.sort_order, f.feature)
          from public.property_features f
          where f.property_id = p.id
        ),
        '[]'::jsonb
      ),
      'related', coalesce(
        (
          select jsonb_agg(rp.related_slug order by rp.sort_order, rp.related_slug)
          from public.property_related rp
          where rp.property_id = p.id
        ),
        '[]'::jsonb
      )
    )
  )
  from public.properties p
  where p.id = p_property_id;
$$;

revoke execute on function public.preview_property(uuid) from public, anon, authenticated;
grant execute on function public.preview_property(uuid) to service_role;
