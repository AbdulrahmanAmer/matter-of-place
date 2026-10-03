-- down:
--   select set_config('storage.allow_delete_query', 'true', true);
--   delete from storage.buckets where id in ('submissions', 'media', 'documents');
set lock_timeout = '5s';

-- Ruling H33: three buckets and nothing else. db:reset does not touch `storage`, so a replay updates in place.
-- `submissions` holds the uploaded originals and, under `staging/`, admin uploads until render_variants moves them;
-- its limits are invariant 13's (uploadLimits). `media` is public and read only through GET /media/<key>; 12 MB is a
-- reel. `documents` holds invoice PDFs and reports behind short-lived signed URLs. No policy on storage.objects:
-- every write and every signed URL comes from the service role.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('submissions', 'submissions', false, 26214400, array['image/jpeg', 'image/png', 'image/heic', 'image/webp']),
  ('media', 'media', true, 12582912, array['image/webp', 'image/jpeg', 'image/png', 'video/mp4']),
  (
    'documents', 'documents', false, 10485760,
    array['application/pdf', 'text/csv', 'text/markdown', 'application/json']
  )
on conflict (id) do update
set name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
