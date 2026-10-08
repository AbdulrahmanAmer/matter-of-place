-- down: drop function public.takedown_media_keys(uuid), public.takedown_mark_posts(uuid);
set lock_timeout = '5s';

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

create or replace function public.takedown_mark_posts(p_property_id uuid)
returns int
language sql
security definer
set search_path = ''
as $$
  -- B8 step 10a (E2E-01): a post a channel already shows cannot be deleted from here, so each one is marked for
  -- withdrawal by hand (B10's screen 12). Returns how many rows it marked; a rerun marks none.
  with marked as (
    update public.social_posts
    set withdraw_required_at = now()
    where property_id = p_property_id and status = 'posted' and withdraw_required_at is null
    returning 1
  )
  select count(*)::int from marked;
$$;

revoke execute on function public.takedown_mark_posts(uuid) from public, anon, authenticated;
grant execute on function public.takedown_mark_posts(uuid) to service_role;
