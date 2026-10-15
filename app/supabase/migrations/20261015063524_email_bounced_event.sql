-- down:
--   delete from public.automation_recipes where trigger = 'email.bounced';
--   delete from public.events where type = 'email.bounced';
--   alter table public.automation_recipes drop constraint automation_recipes_trigger_check;
--   alter table public.automation_recipes add constraint automation_recipes_trigger_check check (trigger in (
--     'submission.received', 'submission.declined', 'submission.accepted', 'submission.awaiting_assets',
--     'invoice.issued', 'payment.marked', 'submission.activated', 'property.published', 'property.unpublished',
--     'asset.approved', 'asset.rejected', 'digest.due', 'inquiry.received', 'subscriber.created',
--     'subscriber.confirmed', 'invoice.voided', 'health.failed', 'subject_request.received'));
--   alter table public.events drop constraint events_type_check;
--   then add it again with the eighteen types of 20261003185349_jobs.sql (the list above without 'email.bounced').
set lock_timeout = '5s';

-- W9 item 3: a bounce or a complaint that puts an address on the do-not-send list becomes the event `email.bounced`
-- (emitted by `apply_email_event`, next migration), so it wakes the colleague who owns the request or inquiry the
-- email was about. The nineteenth catalog event: the events check, the recipe trigger check (one recipe row per event,
-- invariant 8) and its recipe, with no step: the colleague's run is the work.
alter table public.events drop constraint events_type_check;
alter table public.events add constraint events_type_check check (type in (
  'submission.received', 'submission.declined', 'submission.accepted', 'submission.awaiting_assets',
  'invoice.issued', 'payment.marked', 'submission.activated', 'property.published', 'property.unpublished',
  'asset.approved', 'asset.rejected', 'digest.due', 'inquiry.received', 'subscriber.created',
  'subscriber.confirmed', 'invoice.voided', 'health.failed', 'subject_request.received', 'email.bounced'
));

alter table public.automation_recipes drop constraint automation_recipes_trigger_check;
alter table public.automation_recipes add constraint automation_recipes_trigger_check check (trigger in (
  'submission.received', 'submission.declined', 'submission.accepted', 'submission.awaiting_assets',
  'invoice.issued', 'payment.marked', 'submission.activated', 'property.published', 'property.unpublished',
  'asset.approved', 'asset.rejected', 'digest.due', 'inquiry.received', 'subscriber.created',
  'subscriber.confirmed', 'invoice.voided', 'health.failed', 'subject_request.received', 'email.bounced'
));

insert into public.automation_recipes (trigger, name, enabled, steps)
values ('email.bounced', 'Email bounced', true, '[]')
on conflict (trigger) do nothing;
