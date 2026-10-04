create or replace function public.retention_declined_media(p_keep interval)
returns table (media_id uuid, storage_path text)
language sql
stable
security definer
set search_path = ''
as $$
  -- GD-03, DL-04: the uploads of a declined request after p_keep from its review, and of a withdrawn one after p_keep
  -- from its last change (a terminal row is not edited again). It lists only; retention.ts removes the files and then
  -- the rows whose files are gone.
  select m.id, m.storage_path
  from public.submission_media m
  join public.submissions s on s.id = m.submission_id
  where (s.workflow_state = 'Declined' and s.reviewed_at < now() - p_keep)
    or (s.workflow_state = 'Withdrawn' and s.updated_at < now() - p_keep)
  order by m.id;
$$;

revoke execute on function public.retention_declined_media(interval) from public, anon, authenticated;
grant execute on function public.retention_declined_media(interval) to service_role;
