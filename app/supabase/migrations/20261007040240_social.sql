-- down: drop table public.social_posts; drop type public.social_post_status;
--   alter table public.campaign_reports drop constraint campaign_reports_week_uq;
--   delete from public.settings where key in ('meta', 'x', 'linkedin') and value = '{}';
--   The channel_settings rows keep the windows this file wrote: B8b's seed does not overwrite an existing row.
--   The functions come from the fn migration that follows (bun run db:fn): its down is in its own header.
set lock_timeout = '5s';

-- B10: one row per asset and channel (architecture 3.6). No status is added for a cancel: it is `failed` with
-- `error = 'cancelled'`, and the in-flight markers of INT-01 live in `error` while the row is `scheduled`.
create type public.social_post_status as enum ('scheduled', 'posted', 'failed');

-- `property_id` is the asset's, copied once: B8's takedown_mark_posts and the revision check of invariant 2 read
-- it without a join. `withdraw_required_at` and `withdrawn_at` are the rights takedown of E2E-01.
create table public.social_posts (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets (id) on delete cascade,
  property_id uuid not null references public.properties (id) on delete cascade,
  channel text not null check (channel in ('instagram', 'x', 'linkedin', 'facebook', 'youtube')),
  status public.social_post_status not null default 'scheduled',
  scheduled_at timestamptz not null,
  posted_at timestamptz,
  remote_id text,
  permalink text,
  metrics jsonb not null default '{}' check (jsonb_typeof(metrics) = 'object'),
  error text,
  withdraw_required_at timestamptz,
  withdrawn_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint social_posts_asset_channel_key unique (asset_id, channel)
);
create index social_posts_status_scheduled_idx on public.social_posts (status, scheduled_at);
create index social_posts_channel_posted_idx on public.social_posts (channel, posted_at desc);
create index social_posts_property_idx on public.social_posts (property_id);
create index social_posts_withdraw_idx on public.social_posts (withdraw_required_at)
  where withdraw_required_at is not null and withdrawn_at is null;
create trigger social_posts_set_updated_at
before update on public.social_posts
for each row execute function public.set_updated_at();

-- Architecture 3.7: every staff role reads; the rows are written only through the functions of the fn migration,
-- under the service role, and never deleted.
alter table public.social_posts enable row level security;
revoke all on table public.social_posts from anon, authenticated;
grant select on table public.social_posts to authenticated;
grant all on table public.social_posts to service_role;
create policy social_posts_select_staff on public.social_posts for select to authenticated using (app.is_staff());

-- One report per campaign and ISO week (B2 created the table without it).
alter table public.campaign_reports add constraint campaign_reports_week_uq unique (campaign_id, period_start);

-- Seed for every environment. The three live channels stay off until their credentials check passes (invariant 9);
-- the window is Tuesday to Thursday, 09:00 to 12:00 in B8b's zone (ASSUMED, editable on screen 20).
update public.channel_settings set enabled = false where channel in ('instagram', 'x', 'linkedin');
update public.channel_settings
set posting_window = '{"days": [2, 3, 4], "from": "09:00", "to": "12:00", "tz": "America/New_York", "daily_cap": 2}'
where channel in ('instagram', 'x', 'linkedin', 'facebook', 'youtube');

-- The non-secret ids of each channel, empty until a person stores them (G21: not public keys).
insert into public.settings (key, value)
values ('meta', '{}'), ('x', '{}'), ('linkedin', '{}')
on conflict (key) do nothing;
