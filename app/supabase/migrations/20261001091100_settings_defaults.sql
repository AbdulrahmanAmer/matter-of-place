-- down:
--   delete from public.retention_policies where key in ('declined_submission_media', 'inquiries_anonymise',
--     'analytics_events', 'unconfirmed_subscribers', 'contacts_anonymise', 'audit_log');
--   delete from public.settings where key in ('coming_soon_global', 'site', 'environment', 'catalog_version');
set lock_timeout = '5s';

-- Structural rows, so they belong in a migration and run in production too. `catalog_version` goes in last: the
-- three public keys before it fire `settings_bump_catalog_version`, which finds no row to raise and does nothing, so
-- the version starts at 1. A replay conflicts on every key and changes nothing.
-- `site` is B16's shape (G23): contact, legal, social. `hello@` is the public contact and the reply-to of automatic
-- mail, `privacy@` takes privacy requests; `admin@` stays the address for alerts, DMARC reports and accounts (E19).
-- `environment` is the stage before the launch switch, which sets `production` once (ruling H35).
insert into public.settings (key, value)
values
  ('coming_soon_global', 'false'::jsonb),
  (
    'site',
    '{"contact":{"email":"hello@matterofplace.com","phone":null,"privacy_email":"privacy@matterofplace.com"},"legal":{"entity":null,"address":null},"social":{"instagram":null,"x":null,"linkedin":null}}'::jsonb
  ),
  ('environment', '"development"'::jsonb),
  ('catalog_version', '1'::jsonb)
on conflict (key) do nothing;

-- Retention for the tables this slice creates (architecture 10, GD-03; the slice that creates a table seeds its row,
-- G43). `keep_for` null keeps forever. The deletes themselves are B8's `retention` job.
insert into public.retention_policies (key, table_name, keep_for, action, note)
values
  (
    'declined_submission_media', 'submission_media', interval '90 days', 'delete',
    'After submissions.reviewed_at, for a request that was Declined.'
  ),
  ('inquiries_anonymise', 'inquiries', interval '24 months', 'anonymise', 'After created_at.'),
  (
    'analytics_events', 'analytics_events', interval '90 days', 'delete',
    'Whole monthly partitions (ruling H16), dropped only after their days are in analytics_daily.'
  ),
  (
    'unconfirmed_subscribers', 'subscribers', interval '30 days', 'delete',
    'After created_at, while confirmed_at is null (G16).'
  ),
  (
    'contacts_anonymise', 'contacts', interval '24 months', 'anonymise',
    'After the person''s last request; the period is the same as for inquiries (S55).'
  ),
  ('audit_log', 'audit_log', null, 'keep', 'Kept forever.')
on conflict (key) do nothing;
