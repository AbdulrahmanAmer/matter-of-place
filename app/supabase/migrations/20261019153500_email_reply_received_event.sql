-- down:
--   delete from public.automation_recipes where trigger = 'email.reply_received';
--   delete from public.events where type = 'email.reply_received';
--   then put back the events and recipe trigger checks of 20261016143500_w8_0h_inbound_mail.sql (without 'email.reply_received').
set lock_timeout = '5s';

-- W6 item 5 (finishes W4): a reply to an email we sent becomes the event `email.reply_received`, emitted by
-- `email_reply_record` (next migration). It names the reply's row and the source it answers, never its words; the
-- runner wakes the owner on it, triages the text with no tools and shows the owner the triage alone (W8 0a, 0b). The
-- twenty-first catalog event. One recipe row per event (invariant 8), with no step: the colleague's run is the work.
alter table public.events drop constraint events_type_check;
alter table public.events add constraint events_type_check check (type in (
  'submission.received', 'submission.declined', 'submission.accepted', 'submission.awaiting_assets',
  'invoice.issued', 'payment.marked', 'submission.activated', 'property.published', 'property.unpublished',
  'asset.approved', 'asset.rejected', 'digest.due', 'inquiry.received', 'subscriber.created',
  'subscriber.confirmed', 'invoice.voided', 'health.failed', 'subject_request.received', 'email.bounced',
  'email.received', 'email.reply_received'
));

alter table public.automation_recipes drop constraint automation_recipes_trigger_check;
alter table public.automation_recipes add constraint automation_recipes_trigger_check check (trigger in (
  'submission.received', 'submission.declined', 'submission.accepted', 'submission.awaiting_assets',
  'invoice.issued', 'payment.marked', 'submission.activated', 'property.published', 'property.unpublished',
  'asset.approved', 'asset.rejected', 'digest.due', 'inquiry.received', 'subscriber.created',
  'subscriber.confirmed', 'invoice.voided', 'health.failed', 'subject_request.received', 'email.bounced',
  'email.received', 'email.reply_received'
));

insert into public.automation_recipes (trigger, name, enabled, steps)
values ('email.reply_received', 'Email reply received', true, '[]')
on conflict (trigger) do nothing;
