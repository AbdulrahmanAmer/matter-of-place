-- down:
--   delete from public.retention_policies where key = 'inbound_mail';
--   delete from public.pii_columns where table_name = 'inbound_mail';
--   drop table public.inbound_mail;
--   delete from public.automation_recipes where trigger = 'email.received';
--   delete from public.events where type = 'email.received';
--   then put back the events and recipe trigger checks of 20261015100000_email_bounced_event.sql (without 'email.received').
set lock_timeout = '5s';

-- W8 0h (operator, 2026-10-16: "the company and Matter should be able to see all emails"): every message the laptop
-- runner reads in the admin@ mailbox (every folder but Drafts, Templates, Sent, Trash and Outbox), recorded once by its
-- Zoho id and only through inbound_mail_record. A reply to our own email stays in email_replies; the function refuses
-- an id either table holds. The chief editor and the admin read it, as `audit.list` guards its screen and as privacy
-- requests are read (W8 0h review); only the service role writes. The sender's words are outside text: a person
-- reads them here, a colleague only ever sees a triage of them (W8 0b), and Matter only a notice's cleaned subject.
create table public.inbound_mail (
  id uuid primary key default gen_random_uuid(),
  provider_id text not null unique check (char_length(provider_id) between 1 and 200),
  folder text not null check (char_length(folder) between 1 and 100),
  from_email text check (char_length(from_email) <= 320),
  from_name text check (char_length(from_name) <= 200),
  -- The alias of admin@ the message was sent to, read from its To and Cc headers; null for a Bcc.
  alias text check (alias in ('hello', 'listings', 'press', 'privacy', 'billing', 'security', 'admin')),
  subject text not null default '' check (char_length(subject) <= 500),
  body text not null default '' check (char_length(body) <= 6000),
  attachments text[] not null default '{}' check (cardinality(attachments) <= 50),
  received_at timestamptz not null,
  -- email_inbound: a person (or anyone who does not authenticate as a known service); service_notice: Google,
  -- Cloudflare, Sentry and the rest, authenticated; our_mail: our own authenticated notifications.
  source text not null check (source in ('email_inbound', 'service_notice', 'our_mail')),
  service text check (char_length(service) <= 40),
  -- The runner's fixed words about it (a report's counts, or why it was ignored); never the sender's words.
  summary text not null default '' check (char_length(summary) <= 2000),
  -- A DMARC or TLS report's counts, as scripts/workforce/mail-reports.ts read them.
  report jsonb,
  -- W8 0b: the triage of a person's message, written by the runner when its owner's run sorted it.
  triage jsonb,
  owner_slug text,
  -- new: its owner was woken; routed: the triage let the owner answer; held: held for Matter (W8 0d); escalated: a
  -- notice Matter was woken for; recorded: a clean report; ignored: bulk, automatic or our own; spam; capped: past
  -- the hour's cap, waiting for a person.
  state text not null default 'new' check (state in (
    'new', 'routed', 'held', 'escalated', 'recorded', 'ignored', 'spam', 'capped'
  )),
  created_at timestamptz not null default now(),
  -- W8 0h review: only a person's email keeps its body; a service's or our own mail can carry a login code.
  constraint inbound_mail_body_person_only check (source = 'email_inbound' or body = '')
);
create index inbound_mail_received_at_idx on public.inbound_mail (received_at desc, id desc);
-- The hour's cap counts by source and creation time.
create index inbound_mail_source_created_idx on public.inbound_mail (source, created_at);

alter table public.inbound_mail enable row level security;
revoke all on table public.inbound_mail from anon, authenticated;
grant select on table public.inbound_mail to authenticated;
grant all on table public.inbound_mail to service_role;
create policy inbound_mail_select_privacy on public.inbound_mail for select to authenticated
using (app.role_in('admin', 'chief_editor'));

-- Privacy: the sender and their words are personal data. export_subject returns a person's rows by from_email,
-- delete_subject anonymises them (the same migration's functions), and retention deletes every row after a year.
insert into public.pii_columns (table_name, column_name)
values ('inbound_mail', 'from_email'), ('inbound_mail', 'from_name'), ('inbound_mail', 'body')
on conflict do nothing;

insert into public.retention_policies (key, table_name, keep_for, action, enabled, note)
values ('inbound_mail', 'inbound_mail', interval '1 year', 'delete', true,
  'Inbound mail read from the mailbox, after received_at; deleted, not anonymised, as a body quotes a person.')
on conflict (key) do nothing;

-- The twentieth catalog event: a person's email was recorded. It names the row only; the runner wakes the owner on it,
-- triages the row's text with no tools and shows the owner the triage alone (W8 0a, 0b). One recipe row per event
-- (invariant 8), with no step: the colleague's run is the work.
alter table public.events drop constraint events_type_check;
alter table public.events add constraint events_type_check check (type in (
  'submission.received', 'submission.declined', 'submission.accepted', 'submission.awaiting_assets',
  'invoice.issued', 'payment.marked', 'submission.activated', 'property.published', 'property.unpublished',
  'asset.approved', 'asset.rejected', 'digest.due', 'inquiry.received', 'subscriber.created',
  'subscriber.confirmed', 'invoice.voided', 'health.failed', 'subject_request.received', 'email.bounced',
  'email.received'
));

alter table public.automation_recipes drop constraint automation_recipes_trigger_check;
alter table public.automation_recipes add constraint automation_recipes_trigger_check check (trigger in (
  'submission.received', 'submission.declined', 'submission.accepted', 'submission.awaiting_assets',
  'invoice.issued', 'payment.marked', 'submission.activated', 'property.published', 'property.unpublished',
  'asset.approved', 'asset.rejected', 'digest.due', 'inquiry.received', 'subscriber.created',
  'subscriber.confirmed', 'invoice.voided', 'health.failed', 'subject_request.received', 'email.bounced',
  'email.received'
));

insert into public.automation_recipes (trigger, name, enabled, steps)
values ('email.received', 'Email received', true, '[]')
on conflict (trigger) do nothing;
