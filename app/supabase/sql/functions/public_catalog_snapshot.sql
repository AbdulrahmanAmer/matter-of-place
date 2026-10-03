create or replace function public.public_catalog_snapshot()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'catalog_version', (select s.value from public.settings s where s.key = 'catalog_version'),
    'markets', coalesce(
      (select jsonb_agg(to_jsonb(m) order by m.sort_order, m.slug) from public.markets m),
      '[]'::jsonb
    ),
    'regions', coalesce(
      (select jsonb_agg(to_jsonb(r) order by r.market_slug, r.sort_order, r.slug) from public.regions r),
      '[]'::jsonb
    ),
    'market_notes', coalesce(
      (select jsonb_agg(to_jsonb(n) order by n.market_slug, n.sort_order, n.id) from public.market_notes n),
      '[]'::jsonb
    ),
    'market_guide_entries', coalesce(
      (
        select jsonb_agg(to_jsonb(g) order by g.market_slug, g.section, g.sort_order, g.id)
        from public.market_guide_entries g
      ),
      '[]'::jsonb
    ),
    'representatives', coalesce(
      (select jsonb_agg(to_jsonb(r) order by r.name, r.id) from public.representatives r),
      '[]'::jsonb
    ),
    'properties', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
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
            'published_at', p.published_at,
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
          order by p.published_at desc, p.id
        )
        from public.properties p
        where p.editorial_state = 'published'
      ),
      '[]'::jsonb
    ),
    'stories', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', st.id,
            'slug', st.slug,
            'title', st.title,
            'deck', st.deck,
            'category', st.category,
            'market_slug', st.market_slug,
            'image', st.image,
            'image_variants', st.image_variants,
            'body', st.body,
            'properties', st.properties,
            'published_at', st.published_at,
            'updated_at', st.updated_at
          )
          order by st.published_at desc, st.id
        )
        from public.stories st
        where st.editorial_state = 'published'
      ),
      '[]'::jsonb
    ),
    'redirects', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object('from_path', rd.from_path, 'to_path', rd.to_path, 'status', rd.status)
          order by rd.from_path
        )
        from public.redirects rd
        where rd.enabled
      ),
      '[]'::jsonb
    ),
    'slug_history', coalesce(
      (
        select jsonb_agg(jsonb_build_object('slug', h.slug, 'property_id', h.property_id) order by h.slug)
        from public.slug_history h
      ),
      '[]'::jsonb
    ),
    'gone', coalesce(
      (select jsonb_agg(p.slug order by p.slug) from public.properties p where p.taken_down_at is not null),
      '[]'::jsonb
    )
  )
$$;
