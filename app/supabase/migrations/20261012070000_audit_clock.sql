-- down: update public.schedule_settings set cron = '0 12 * * 6' where key = 'audit';
set lock_timeout = '5s';

-- W3 (2026-10-12): the audit routine runs from the "MOP Audit" task on the operator's laptop at 09:00 Saturday, Cairo
-- time (scripts/workforce/install.ps1). The row only records that external clock, and the admin now says it in
-- words, so it must say 09:00, not 15:00: 09:00 Cairo summer time is 06:00 UTC.
update public.schedule_settings set cron = '0 6 * * 6' where key = 'audit';
