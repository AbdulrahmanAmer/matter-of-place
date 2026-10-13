-- down:
--   delete from public.retention_policies where key = 'email_replies';
--   delete from public.pii_columns where table_name = 'email_replies';
--   drop table public.email_replies;
set lock_timeout = '5s';

-- W4 (operator, 2026-10-13): replies to the email we send, read from the Zoho mailbox by the laptop runner and recorded
-- only through email_reply_record (supabase/sql/functions/email_reply_record.sql). Staff read; only the service role
-- writes. A reply is outside text: it reaches its colleague as a fenced system line and never as a person's.
create table public.email_replies (
  id uuid primary key default gen_random_uuid(),
  provider_id text not null unique check (char_length(provider_id) between 1 and 200),
  from_email text,
  from_name text,
  subject text not null default '' check (char_length(subject) <= 500),
  body text not null default '' check (char_length(body) <= 6000),
  received_at timestamptz not null,
  send_id uuid references public.email_messages (id) on delete set null,
  entity text check (entity in ('submission', 'inquiry', 'subscriber', 'subject_request')),
  entity_id uuid,
  owner_slug text,
  state text not null default 'new' check (state in ('new', 'seen', 'answered', 'ignored')),
  created_at timestamptz not null default now()
);
create index email_replies_entity_idx on public.email_replies (entity, entity_id);
create index email_replies_received_at_idx on public.email_replies (received_at desc);

alter table public.email_replies enable row level security;
revoke all on table public.email_replies from anon, authenticated;
grant select on table public.email_replies to authenticated;
grant all on table public.email_replies to service_role;
create policy email_replies_select_staff on public.email_replies for select to authenticated using (app.is_staff());

-- Privacy: the sender and their words are personal data, covered by export, delete and retention.
insert into public.pii_columns (table_name, column_name)
values ('email_replies', 'from_email'), ('email_replies', 'from_name'), ('email_replies', 'body')
on conflict do nothing;

insert into public.retention_policies (key, table_name, keep_for, action, enabled, note)
values ('email_replies', 'email_replies', interval '1 year', 'delete', true,
  'Email replies read from the mailbox, after received_at; deleted, not anonymised, as a body quotes a person.')
on conflict (key) do nothing;
