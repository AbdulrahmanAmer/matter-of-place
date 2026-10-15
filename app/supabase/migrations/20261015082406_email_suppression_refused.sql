-- down:
--   delete from public.email_suppressions where reason = 'refused';
--   alter table public.email_suppressions drop constraint email_suppressions_reason_check;
--   alter table public.email_suppressions add constraint email_suppressions_reason_check
--     check (reason in ('bounce', 'complaint', 'manual'));
set lock_timeout = '5s';

-- W9 item 1: an address the laptop runner's SMTP probe found refused by its mail server (`mailbox_refused`) or on a
-- domain that receives no email is suppressed with its own reason, so the send step never mails it and the request
-- page can say why.
alter table public.email_suppressions drop constraint email_suppressions_reason_check;
alter table public.email_suppressions add constraint email_suppressions_reason_check
  check (reason in ('bounce', 'complaint', 'manual', 'refused'));
