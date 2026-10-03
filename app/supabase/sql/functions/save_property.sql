create or replace function public.save_property(p_id uuid, p_expected_version int, p_patch jsonb)
returns public.properties
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- savePropertyAllowedKeys of tests/db/schema-manifest.ts. System, state and publication columns have their own
  -- writers (G6, G23, G66).
  v_allowed constant text[] := array[
    'slug', 'title', 'market_slug', 'region_slug', 'city', 'neighborhood', 'state', 'country', 'address',
    'coordinates', 'price', 'currency', 'beds', 'baths', 'interior_sq_ft', 'lot_acres', 'year_built', 'type',
    'style', 'architect', 'designer', 'status', 'story', 'place', 'representative_id', 'presented_by_owner',
    'listing_url', 'hero_rank', 'featured_rank', 'updated_by'
  ];
  v_old public.properties;
  v_new public.properties;
begin
  select * into v_old from public.properties where id = p_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_old.version <> p_expected_version then
    raise exception 'version_conflict' using errcode = '40001';
  end if;
  if exists (select 1 from jsonb_object_keys(p_patch) k where k <> all (v_allowed)) then
    raise exception 'invalid_patch_key' using errcode = '22023';
  end if;
  v_new := jsonb_populate_record(v_old, p_patch);
  -- One update, so every trigger runs; an empty patch only raises the version.
  update public.properties
  set slug = v_new.slug,
    title = v_new.title,
    market_slug = v_new.market_slug,
    region_slug = v_new.region_slug,
    city = v_new.city,
    neighborhood = v_new.neighborhood,
    state = v_new.state,
    country = v_new.country,
    address = v_new.address,
    coordinates = v_new.coordinates,
    price = v_new.price,
    currency = v_new.currency,
    beds = v_new.beds,
    baths = v_new.baths,
    interior_sq_ft = v_new.interior_sq_ft,
    lot_acres = v_new.lot_acres,
    year_built = v_new.year_built,
    type = v_new.type,
    style = v_new.style,
    architect = v_new.architect,
    designer = v_new.designer,
    status = v_new.status,
    story = v_new.story,
    place = v_new.place,
    representative_id = v_new.representative_id,
    presented_by_owner = v_new.presented_by_owner,
    listing_url = v_new.listing_url,
    hero_rank = v_new.hero_rank,
    featured_rank = v_new.featured_rank,
    updated_by = v_new.updated_by,
    version = v_old.version + 1
  where id = p_id
  returning * into v_new;
  return v_new;
end;
$$;
