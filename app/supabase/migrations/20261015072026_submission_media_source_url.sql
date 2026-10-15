-- down:
--   alter table public.submission_media drop column source_url;
set lock_timeout = '5s';

-- W9 item 4: a photograph a colleague pulled from the request's own listing or photography link keeps the address it
-- came from. Null for a photograph the submitter uploaded.
alter table public.submission_media add column source_url text
  check (source_url is null or (source_url ~ '^https?://' and length(source_url) <= 2000));
