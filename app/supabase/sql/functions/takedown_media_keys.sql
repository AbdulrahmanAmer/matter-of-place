create or replace function public.takedown_media_keys(p_property_id uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  -- B8 step 10a (E2E-01, ruling H33 (1)): every key the property holds in the bucket `media`, once each, for the
  -- takedown_media job. A photograph stores its master key and the sizes only (P-335), so each rendered size's key is
  -- derived from the master as `variantKey` in src/server/assets/spec.ts does.
  select coalesce(array_agg(distinct k.key), '{}')
  from (
    select m.media_key as key
    from public.property_media m
    where m.property_id = p_property_id
    union all
    select regexp_replace(m.media_key, '^o/([^/]+)/(\d+-[0-9a-f]{8})\.webp$', 'v/\1/\2/')
      || v.name || case when v.name in ('og', 'carousel') then '.jpg' else '.webp' end
    from public.property_media m
    cross join lateral jsonb_object_keys(m.variants) as v (name)
    where m.property_id = p_property_id and m.media_key ~ '^o/[^/]+/\d+-[0-9a-f]{8}\.webp$'
    union all
    select f.file ->> 'media_key'
    from public.assets a
    cross join lateral jsonb_array_elements(a.files) as f (file)
    where a.property_id = p_property_id
    union all
    select unnest(array[p.video ->> 'src', p.video ->> 'poster', p.og_image_key])
    from public.properties p
    where p.id = p_property_id
  ) k
  where k.key is not null;
$$;

revoke execute on function public.takedown_media_keys(uuid) from public, anon, authenticated;
grant execute on function public.takedown_media_keys(uuid) to service_role;
