-- down: update public.settings set value = value - 'csp_enforce' - 'maintenance' where key = 'flags';
set lock_timeout = '5s';

-- B17 step 1: the two flags the essentials slice reads. csp_enforce moves the Content-Security-Policy from
-- report only to enforcing (H1 flips it from Admin, Settings, Flags); maintenance answers 503 on public pages.
-- Structural, so it runs in production too. The settings trigger bumps catalog_version (F25 a). With no
-- `flags` row the update touches nothing and getFlags still reads both as false.
update public.settings
  set value = coalesce(value, '{}'::jsonb) || '{"csp_enforce": false, "maintenance": false}'::jsonb
  where key = 'flags';
