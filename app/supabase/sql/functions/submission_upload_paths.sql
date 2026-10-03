create or replace function public.submission_upload_paths(p_submission_id uuid, p_media_ids uuid[])
returns table (media_id uuid, storage_path text)
language sql
stable
security definer
set search_path = ''
as $$
  -- The rows of one submission still waiting for their object, at most one signing batch (E2E-02).
  select m.id, m.storage_path
  from public.submission_media m
  where m.submission_id = p_submission_id
    and m.id = any (p_media_ids)
    and m.uploaded_at is null
  order by m.sort_order
  limit 10;
$$;

revoke execute on function public.submission_upload_paths(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.submission_upload_paths(uuid, uuid[]) to service_role;
