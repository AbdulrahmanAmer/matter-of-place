-- down:
--   drop trigger properties_bump_catalog_version_ins on public.properties;
--   drop trigger properties_bump_catalog_version_upd on public.properties;
--   drop trigger properties_bump_catalog_version_del on public.properties;
--   drop trigger stories_bump_catalog_version_ins on public.stories;
--   drop trigger stories_bump_catalog_version_upd on public.stories;
--   drop trigger stories_bump_catalog_version_del on public.stories;
--   drop trigger markets_bump_catalog_version on public.markets;
--   drop trigger regions_bump_catalog_version on public.regions;
--   drop trigger market_notes_bump_catalog_version on public.market_notes;
--   drop trigger market_guide_entries_bump_catalog_version on public.market_guide_entries;
--   drop trigger property_media_bump_catalog_version on public.property_media;
--   drop trigger property_features_bump_catalog_version on public.property_features;
--   drop trigger property_related_bump_catalog_version on public.property_related;
--   drop trigger representatives_bump_catalog_version on public.representatives;
--   drop trigger slug_history_bump_catalog_version on public.slug_history;
--   drop trigger redirects_bump_catalog_version on public.redirects;
--   drop trigger settings_bump_catalog_version on public.settings;
--   drop trigger settings_bump_catalog_version_del on public.settings;
--   drop function public.public_state(), public.public_catalog_snapshot(), public.tg_bump_catalog_version(),
--     public.bump_catalog_version();
--   drop index public.properties_published_at_idx, public.stories_published_at_idx,
--     public.redirects_enabled_from_path_idx;
set lock_timeout = '5s';

-- Invariant 8 (G21): settings.catalog_version rises by one on every change to published catalog content, to
-- slug_history and redirects, to markets.coming_soon and to the five public settings keys. The triggers below call it;
-- outside them only B8b's bump_catalog_version step and B4's edge test do, through rpc (architecture 13 rule 4).
create or replace function public.bump_catalog_version()
returns bigint
language sql
security definer
set search_path = ''
as $$
  update public.settings
  set value = to_jsonb((value #>> '{}')::bigint + 1)
  where key = 'catalog_version'
  returning (value #>> '{}')::bigint;
$$;

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

-- A row of properties or stories is catalog content while it is published. A takedown changes `gone` even when the
-- row was already archived.
create trigger properties_bump_catalog_version_ins
after insert on public.properties
for each row when (new.editorial_state = 'published')
execute function public.tg_bump_catalog_version();
create trigger properties_bump_catalog_version_upd
after update on public.properties
for each row when (
  old.editorial_state = 'published'
  or new.editorial_state = 'published'
  or old.taken_down_at is distinct from new.taken_down_at
)
execute function public.tg_bump_catalog_version();
create trigger properties_bump_catalog_version_del
after delete on public.properties
for each row when (old.editorial_state = 'published' or old.taken_down_at is not null)
execute function public.tg_bump_catalog_version();

create trigger stories_bump_catalog_version_ins
after insert on public.stories
for each row when (new.editorial_state = 'published')
execute function public.tg_bump_catalog_version();
create trigger stories_bump_catalog_version_upd
after update on public.stories
for each row when (old.editorial_state = 'published' or new.editorial_state = 'published')
execute function public.tg_bump_catalog_version();
create trigger stories_bump_catalog_version_del
after delete on public.stories
for each row when (old.editorial_state = 'published')
execute function public.tg_bump_catalog_version();

-- Every row of these tables travels in the snapshot: one bump per statement.
create trigger markets_bump_catalog_version
after insert or update or delete on public.markets
for each statement execute function public.tg_bump_catalog_version();
create trigger regions_bump_catalog_version
after insert or update or delete on public.regions
for each statement execute function public.tg_bump_catalog_version();
create trigger market_notes_bump_catalog_version
after insert or update or delete on public.market_notes
for each statement execute function public.tg_bump_catalog_version();
create trigger market_guide_entries_bump_catalog_version
after insert or update or delete on public.market_guide_entries
for each statement execute function public.tg_bump_catalog_version();
create trigger property_media_bump_catalog_version
after insert or update or delete on public.property_media
for each statement execute function public.tg_bump_catalog_version();
create trigger property_features_bump_catalog_version
after insert or update or delete on public.property_features
for each statement execute function public.tg_bump_catalog_version();
create trigger property_related_bump_catalog_version
after insert or update or delete on public.property_related
for each statement execute function public.tg_bump_catalog_version();
create trigger representatives_bump_catalog_version
after insert or update or delete on public.representatives
for each statement execute function public.tg_bump_catalog_version();
create trigger redirects_bump_catalog_version
after insert or update or delete on public.redirects
for each statement execute function public.tg_bump_catalog_version();

-- Row level: enforce_slug_immutable deletes a reclaimed slug before it records the old one, and that delete
-- usually matches no row, so a statement trigger would bump twice for one rename.
create trigger slug_history_bump_catalog_version
after insert or update or delete on public.slug_history
for each row execute function public.tg_bump_catalog_version();

-- G21: the public keys only. catalog_version is outside the list, so the bump's own update never recurses, and the
-- admin keys (meta, x, linkedin, caption_model, invoice, email, notifications, agent_daily_limits, resend) do not
-- bump. A slice that adds a key a public render reads adds it here in a new migration.
create trigger settings_bump_catalog_version
after insert or update on public.settings
for each row when (new.key in ('flags', 'coming_soon_global', 'site', 'environment', 'og_static'))
execute function public.tg_bump_catalog_version();
create trigger settings_bump_catalog_version_del
after delete on public.settings
for each row when (old.key in ('flags', 'coming_soon_global', 'site', 'environment', 'og_static'))
execute function public.tg_bump_catalog_version();

-- Invariant 16: the two public reads, one select each, so catalog_version and the rows come from one statement.
-- `site` carries exactly contact, legal and social (G23); illustrative content shows only in development and preview
-- (F26 c).
create or replace function public.public_state()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'catalog_version', (select s.value from public.settings s where s.key = 'catalog_version'),
    'flags', coalesce((select s.value from public.settings s where s.key = 'flags'), '{}'::jsonb),
    'coming_soon_global', (select s.value from public.settings s where s.key = 'coming_soon_global'),
    'coming_soon_markets', coalesce(
      (select jsonb_object_agg(m.slug, m.coming_soon) from public.markets m),
      '{}'::jsonb
    ),
    'site', (
      select jsonb_build_object('contact', s.value -> 'contact', 'legal', s.value -> 'legal', 'social', s.value -> 'social')
      from public.settings s
      where s.key = 'site'
    ),
    'illustrative_content', coalesce(
      (select s.value #>> '{}' in ('development', 'preview') from public.settings s where s.key = 'environment'),
      false
    ),
    'og_static', coalesce((select s.value from public.settings s where s.key = 'og_static'), '{}'::jsonb)
  )
$$;

-- Only published properties and stories, each object exactly publicPropertyKeys, publicStoryKeys and publicMediaKeys
-- of tests/db/schema-manifest.ts; only stored photographs (G25); `gone` lists taken-down slugs (invariant 12).
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

revoke execute on function public.bump_catalog_version(), public.tg_bump_catalog_version(), public.public_state(),
  public.public_catalog_snapshot()
from public, anon, authenticated;
grant execute on function public.bump_catalog_version(), public.public_state(), public.public_catalog_snapshot()
to service_role;

-- The reads' other indexes exist since migration 4: properties_market_idx, property_media_idx, the primary keys of
-- property_features and property_related, regions_market_idx, market_notes_market_idx,
-- market_guide_entries_market_idx and slug_history_property_idx.
create index properties_published_at_idx on public.properties (published_at desc)
where editorial_state = 'published';
create index stories_published_at_idx on public.stories (published_at desc)
where editorial_state = 'published';
create index redirects_enabled_from_path_idx on public.redirects (from_path)
where enabled;
