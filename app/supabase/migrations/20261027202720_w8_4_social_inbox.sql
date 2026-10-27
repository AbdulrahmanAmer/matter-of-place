-- down:
--   select cron.unschedule('read_social_inbox');
--   delete from public.automation_recipes where trigger = 'social.inbox_received';
--   delete from public.events where type = 'social.inbox_received';
--   then put back the events and recipe trigger checks of 20261019153500_email_reply_received_event.sql (without 'social.inbox_received').
--   delete from public.retention_policies where key = 'social_inbox';
--   delete from public.pii_columns where table_name = 'social_inbox';
--   drop table public.social_inbox_cursors;
--   drop table public.social_inbox;
set lock_timeout = '5s';

-- W8 item 4 (Talking back): every Instagram comment on our published posts and every message in our conversations,
-- read on a schedule by the `read_social_inbox` job and recorded once by its Graph id, only through
-- social_inbox_record. A comment belongs to our social_posts row; a message to its conversation. The author is kept as
-- the handle alone, no other personal data (a reply to a message reads the recipient from the conversation at send
-- time). The words are outside text: a person reads them on the Channels screen, the Social colleague only ever sees a
-- triage of them (W8 0a, 0b). Staff read it; only the service role writes.
create table public.social_inbox (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('instagram')),
  kind text not null check (kind in ('comment', 'message')),
  graph_id text not null unique check (char_length(graph_id) between 1 and 200),
  -- A comment: the Instagram media it is on; a message: its conversation.
  thread_graph_id text not null check (char_length(thread_graph_id) between 1 and 200),
  -- A reply under a comment: the comment it answers.
  parent_graph_id text check (char_length(parent_graph_id) <= 200),
  social_post_id uuid references public.social_posts (id),
  author_handle text not null default '' check (char_length(author_handle) <= 100),
  body text not null default '' check (char_length(body) <= 4000),
  received_at timestamptz not null,
  -- new: the Social colleague was woken; proposed: its reply waits in Approvals; answered: the reply went out;
  -- ignored: nothing is sent (a person decided, or the reply was declined).
  state text not null default 'new' check (state in ('new', 'proposed', 'answered', 'ignored')),
  -- Set null when retention deletes the decided approval (agent_approvals_decided, 90 days).
  approval_id uuid references public.agent_approvals (id) on delete set null,
  -- The send of an approved reply: `sending` once begun (a rerun never sends twice), then sent, refused (posting is
  -- off here), failed (Graph said no) or unknown (a send that began and never came back).
  reply_state text check (reply_state in ('sending', 'sent', 'refused', 'failed', 'unknown')),
  reply_graph_id text check (char_length(reply_graph_id) <= 200),
  reply_error text check (char_length(reply_error) <= 1000),
  replied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint social_inbox_post_comment_only check (kind = 'comment' or social_post_id is null)
);
create index social_inbox_received_idx on public.social_inbox (received_at desc, id desc);
create index social_inbox_post_idx on public.social_inbox (social_post_id) where social_post_id is not null;
create index social_inbox_thread_idx on public.social_inbox (thread_graph_id, received_at);

alter table public.social_inbox enable row level security;
revoke all on table public.social_inbox from anon, authenticated;
grant select on table public.social_inbox to authenticated;
grant all on table public.social_inbox to service_role;
create policy social_inbox_select_staff on public.social_inbox for select to authenticated using (app.is_staff());

-- Where the last read stopped, per kind: comments and messages newer than it are read on the next tick.
create table public.social_inbox_cursors (
  key text primary key check (key in ('instagram_comments', 'instagram_messages')),
  read_until timestamptz not null,
  read_at timestamptz not null default now()
);
alter table public.social_inbox_cursors enable row level security;
revoke all on table public.social_inbox_cursors from anon, authenticated;
grant all on table public.social_inbox_cursors to service_role;

-- Privacy: the handle and the words are personal data; retention deletes every row after a year.
insert into public.pii_columns (table_name, column_name)
values ('social_inbox', 'author_handle'), ('social_inbox', 'body')
on conflict do nothing;

insert into public.retention_policies (key, table_name, keep_for, action, enabled, note)
values ('social_inbox', 'social_inbox', interval '1 year', 'delete', true,
  'Instagram comments and messages, after received_at; deleted, not anonymised, as a body quotes a person.')
on conflict (key) do nothing;

-- The twenty-second catalog event: a comment or a message was recorded. It names the row only; the runner wakes the
-- Social colleague on it, triages the row's text with no tools and shows the colleague the triage alone (W8 0a, 0b).
-- One recipe row per event (invariant 8), with no step: the colleague's run is the work.
alter table public.events drop constraint events_type_check;
alter table public.events add constraint events_type_check check (type in (
  'submission.received', 'submission.declined', 'submission.accepted', 'submission.awaiting_assets',
  'invoice.issued', 'payment.marked', 'submission.activated', 'property.published', 'property.unpublished',
  'asset.approved', 'asset.rejected', 'digest.due', 'inquiry.received', 'subscriber.created',
  'subscriber.confirmed', 'invoice.voided', 'health.failed', 'subject_request.received', 'email.bounced',
  'email.received', 'email.reply_received', 'social.inbox_received'
));

alter table public.automation_recipes drop constraint automation_recipes_trigger_check;
alter table public.automation_recipes add constraint automation_recipes_trigger_check check (trigger in (
  'submission.received', 'submission.declined', 'submission.accepted', 'submission.awaiting_assets',
  'invoice.issued', 'payment.marked', 'submission.activated', 'property.published', 'property.unpublished',
  'asset.approved', 'asset.rejected', 'digest.due', 'inquiry.received', 'subscriber.created',
  'subscriber.confirmed', 'invoice.voided', 'health.failed', 'subject_request.received', 'email.bounced',
  'email.received', 'email.reply_received', 'social.inbox_received'
));

insert into public.automation_recipes (trigger, name, enabled, steps)
values ('social.inbox_received', 'Instagram comment or message received', true, '[]')
on conflict (trigger) do nothing;

-- The read every 15 minutes, keyed `read_social_inbox:<UTC minute>` (invariant 1). A fixed pg_cron row like
-- meta_token_refresh (20261004065712_retention.sql): schedule_settings' key check holds the recipe clocks only. The job
-- does nothing, and says so once, while Instagram is off or has no token.
select cron.unschedule('read_social_inbox') where exists (select 1 from cron.job where jobname = 'read_social_inbox');
select cron.schedule(
  'read_social_inbox',
  '*/15 * * * *',
  $$select public.enqueue_job('read_social_inbox', '{"params": {}, "data": {}}'::jsonb,
    'read_social_inbox:' || to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI'))$$
);
