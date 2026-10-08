create or replace function public.property_detail(p_property_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  -- Screen 8 (B7 step 7): the row with its version (GD-01), its photographs in sequence, its lists, its
  -- representative and the request it came from, in one call. Null when there is no such property.
  select jsonb_build_object(
    'property', to_jsonb(p) - array['search_text', 'preview_nonce', 'coordinates', 'video'],
    'media', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', m.id, 'media_key', m.media_key, 'staging_path', m.staging_path, 'alt', m.alt,
            'orientation', m.orientation, 'sort_order', m.sort_order
          )
          order by m.sort_order, m.id
        )
        from public.property_media m
        where m.property_id = p.id
      ),
      '[]'::jsonb
    ),
    'features', coalesce(
      (
        select jsonb_agg(f.feature order by f.sort_order, f.feature)
        from public.property_features f where f.property_id = p.id
      ),
      '[]'::jsonb
    ),
    'related', coalesce(
      (
        select jsonb_agg(r.related_slug order by r.sort_order, r.related_slug)
        from public.property_related r where r.property_id = p.id
      ),
      '[]'::jsonb
    ),
    'representative', (
      select jsonb_build_object(
        'id', r.id, 'name', r.name, 'brokerage', r.brokerage, 'license', r.license, 'email', r.email, 'phone', r.phone
      )
      from public.representatives r where r.id = p.representative_id
    ),
    'submission', (
      select jsonb_build_object('id', s.id, 'workflow_state', s.workflow_state, 'submitter_kind', s.submitter_kind)
      from public.submissions s where s.id = p.submission_id
    )
  )
  from public.properties p
  where p.id = p_property_id;
$$;

revoke execute on function public.property_detail(uuid) from public, anon, authenticated;
grant execute on function public.property_detail(uuid) to service_role;
