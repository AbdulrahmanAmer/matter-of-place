create or replace function public.retention_requested_visuals(p_keep interval)
returns table (asset_id uuid, media_keys text[])
language sql
stable
security definer
set search_path = ''
as $$
  -- W8 item 1, GD-03: a visual made on request (a reel or a still post about a market, a story or the brand, H107) that
  -- a person rejected and nobody touched for p_keep, with the keys of its files under `requested/` in bucket `media`.
  -- A property's asset goes with its property, and an asset any post points at stays with that post. It lists only;
  -- retention.ts removes the files and then the rows whose files are gone.
  select a.id,
    coalesce(
      array_agg(f.file ->> 'media_key') filter (where f.file ->> 'media_key' like 'requested/%'),
      '{}'
    )
  from public.assets a
  left join lateral jsonb_array_elements(a.files) as f (file) on true
  where a.subject <> 'property'
    and a.status = 'rejected'
    and a.meta ? 'request_id'
    and a.updated_at < now() - p_keep
    and not exists (select 1 from public.social_posts s where s.asset_id = a.id)
    and not exists (select 1 from public.proposed_post_channels c where c.asset_id = a.id)
  group by a.id
  order by a.id;
$$;

revoke execute on function public.retention_requested_visuals(interval) from public, anon, authenticated;
grant execute on function public.retention_requested_visuals(interval) to service_role;
