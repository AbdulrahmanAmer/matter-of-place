create or replace function public.retention_accepted_media(p_keep interval)
returns table (media_id uuid, storage_path text)
language sql
stable
security definer
set search_path = ''
as $$
  -- PERF-08 (c), ruling H33 (8): a request's originals never leave the submissions bucket, so they go once its
  -- property has photographs and every one has its variants in the media bucket (media_key set, nothing staged), and
  -- no copy of the request's photographs is still to finish. It lists only, like retention_declined_media.
  select m.id, m.storage_path
  from public.submission_media m
  join public.submissions s on s.id = m.submission_id
  join public.properties p on p.submission_id = s.id
  where s.reviewed_at < now() - p_keep
    and exists (select 1 from public.property_media pm where pm.property_id = p.id)
    and not exists (
      select 1 from public.property_media pm
      where pm.property_id = p.id and (pm.media_key is null or pm.staging_path is not null)
    )
    and not exists (
      select 1 from public.jobs j
      where j.type = 'copy_submission_media'
        and j.payload -> 'data' ->> 'property_id' = p.id::text
        and j.status not in ('done', 'cancelled')
    )
  order by m.id;
$$;

revoke execute on function public.retention_accepted_media(interval) from public, anon, authenticated;
grant execute on function public.retention_accepted_media(interval) to service_role;
