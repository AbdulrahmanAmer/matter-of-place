-- down:
--   alter table public.vendor_usage drop constraint vendor_usage_line_check;
--   delete from public.vendor_usage where line = 'claude_week';
--   alter table public.vendor_usage add constraint vendor_usage_line_check
--     check (line in ('workers_requests_day', 'storage_egress', 'sentry_errors', 'actions_minutes'));
set lock_timeout = '5s';

-- W6 item 2: the weekly Claude allowance of the account signed in on the laptop, recorded by the runner each pass
-- (used = percent of the week, limit 100, note = when the week resets) so the Office can show it. A vendor line, not a
-- setting: a write to public.settings bumps the catalog version and would empty the public cache every minute (S52).
alter table public.vendor_usage drop constraint vendor_usage_line_check;
alter table public.vendor_usage add constraint vendor_usage_line_check
  check (line in ('workers_requests_day', 'storage_egress', 'sentry_errors', 'actions_minutes', 'claude_week'));
