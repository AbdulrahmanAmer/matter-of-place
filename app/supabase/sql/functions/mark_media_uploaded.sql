create or replace function public.mark_media_uploaded(p_media_id uuid, p_mime text, p_sha256 text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with changed as (
    update public.submission_media
    set uploaded_at = now(), mime = p_mime, sha256 = p_sha256
    where id = p_media_id and uploaded_at is null
    returning 1
  )
  select exists (select 1 from changed);
$$;

revoke execute on function public.mark_media_uploaded(uuid, text, text) from public, anon, authenticated;
grant execute on function public.mark_media_uploaded(uuid, text, text) to service_role;
