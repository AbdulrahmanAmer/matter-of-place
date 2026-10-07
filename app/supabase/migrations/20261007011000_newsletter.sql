-- down:
--   drop table public.newsletter_issues;
--   drop index public.email_events_broadcast_type_idx, public.subscribers_last_engaged_idx;
--   delete from public.email_templates where key = 'market_open';
--   delete from public.settings where key = 'resend';
--   The functions and the trigger come from the fn migration that follows (bun run db:fn): its down is in its own header.
set lock_timeout = '5s';

-- B11 step 4: Place Notes issues (architecture 3.6). `status` changes only through the functions of the fn migration;
-- approve writes `send_at` into `scheduled_for`, and `approval_count` keys the send and preview jobs of one approval.
create table public.newsletter_issues (
  id uuid primary key default gen_random_uuid(),
  number int not null unique check (number >= 1),
  scheduled_for timestamptz,
  status text not null default 'draft' check (status in ('draft', 'approved', 'sending', 'sent')),
  blocks jsonb not null default '[]' check (jsonb_typeof(blocks) = 'array'),
  subject text,
  preheader text,
  resend_broadcast_id text,
  metrics jsonb not null default '{}' check (jsonb_typeof(metrics) = 'object'),
  approved_by uuid references auth.users (id) on delete set null,
  approval_count int not null default 0 check (approval_count >= 0),
  send_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- One open draft at a time: what makes concurrent `queue_digest` adds land in one issue.
create unique index newsletter_issues_one_draft_idx on public.newsletter_issues ((true)) where status = 'draft';
create index newsletter_issues_approved_by_idx on public.newsletter_issues (approved_by);
create trigger newsletter_issues_set_updated_at
before update on public.newsletter_issues
for each row execute function public.set_updated_at();

-- Architecture 3.7: every staff role reads; writes go through the service-role functions only, and nothing deletes.
alter table public.newsletter_issues enable row level security;
revoke all on table public.newsletter_issues from anon, authenticated;
grant select on table public.newsletter_issues to authenticated;
grant all on table public.newsletter_issues to service_role;
create policy newsletter_issues_select_staff on public.newsletter_issues for select to authenticated
using (app.is_staff());

-- Issue metrics count `email_events` per broadcast and type.
create index email_events_broadcast_type_idx on public.email_events (broadcast_id, type);

-- GG-05: B5 added both engagement columns; this fails here if either is missing.
do $$
begin
  perform s.last_engaged_at, s.repermission_sent_at from public.subscribers s limit 0;
end;
$$;
create index if not exists subscribers_last_engaged_idx on public.subscribers (last_engaged_at)
where unsubscribed_at is null;

-- The Resend audience ids, written by `newsletter_set_audience` the first time each audience is used.
insert into public.settings (key, value)
values ('resend', '{"audiences": {}}'::jsonb)
on conflict (key) do nothing;

-- Invariant 14, G15: the one notice of an interest signup, in B5's row shape (G46). The same copy as
-- src/templates/email/market-open.tsx; an edited row survives a replay.
insert into public.email_templates (key, class, subject, preheader, body, variables, enabled)
values (
  'market_open', 'bulk', 'Matter of Place now publishes in {{market_name}}', 'The first property is on the site.',
  '[
    {"type": "heading", "text": "{{market_name}} is open."},
    {"type": "paragraph", "text": "You asked to hear when Matter of Place publishes its first property in {{market_name}}. It is on the site now."},
    {"type": "button", "label": "See {{market_name}}", "url": "{{market_url}}"},
    {"type": "paragraph", "text": "This is the one message we promised. Place Notes, our fortnightly letter, is a separate sign-up on the site."}
  ]',
  '{market_name,market_url}', true
)
on conflict (key) do nothing;
