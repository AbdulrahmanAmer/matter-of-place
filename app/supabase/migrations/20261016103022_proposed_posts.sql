-- down:
--   drop table public.proposed_post_revisions;
--   drop table public.proposed_post_channels;
--   drop table public.proposed_posts;
--   drop type public.proposed_post_status;
--   delete from public.social_posts where property_id is null;
--   alter table public.social_posts alter column property_id set not null;
--   The functions come from the fn migration that follows (bun run db:fn): its down is in its own header.
set lock_timeout = '5s';

-- W8 item 10 (rulings H116, H135): a post a colleague or a person proposes, kept apart from `social_posts`, which records
-- only what went to a channel. Approval turns each channel of the post into an approved asset of its subject and the
-- `social_posts` row the channel posting reads; nothing posts without a person's yes.
create type public.proposed_post_status as enum ('proposed', 'rejected', 'approved', 'scheduled', 'posted');

-- A brand post names neither a property nor a request (item 1). The proposer is a colleague (its slug) or a person;
-- Matter's key proposes as the colleague `matter` under its own account.
create table public.proposed_posts (
  id uuid primary key default gen_random_uuid(),
  title text not null check (btrim(title) <> '' and char_length(title) <= 200),
  property_id uuid references public.properties (id) on delete cascade,
  submission_id uuid references public.submissions (id) on delete cascade,
  proposer_kind public.actor_kind not null,
  proposer_agent text,
  proposer_user uuid references auth.users (id) on delete set null,
  run_id uuid references public.agent_runs (id) on delete set null,
  test boolean not null default false,
  status public.proposed_post_status not null default 'proposed',
  revision integer not null default 1 check (revision >= 1),
  rejection_note text,
  approved_by uuid references auth.users (id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint proposed_posts_proposer check (
    (proposer_kind = 'agent' and proposer_agent is not null)
    or (proposer_kind = 'human' and proposer_agent is null)
  ),
  constraint proposed_posts_rejected_note check (status <> 'rejected' or rejection_note is not null)
);
create index proposed_posts_status_created_idx on public.proposed_posts (status, created_at desc);
create index proposed_posts_property_idx on public.proposed_posts (property_id) where property_id is not null;
create index proposed_posts_submission_idx on public.proposed_posts (submission_id) where submission_id is not null;
create index proposed_posts_proposer_user_idx on public.proposed_posts (proposer_user);
create index proposed_posts_run_idx on public.proposed_posts (run_id);
create index proposed_posts_approved_by_idx on public.proposed_posts (approved_by);
create trigger proposed_posts_set_updated_at
before update on public.proposed_posts
for each row execute function public.set_updated_at();

-- One row per channel of each revision, so a revision never overwrites the last. `media` holds the ordered images or
-- the reel, each a key in the public `media` bucket with the path a person can open, its alt text and its size.
-- Facebook and YouTube are disabled channel blocks: the functions refuse them by name, and the check refuses them here.
create table public.proposed_post_channels (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.proposed_posts (id) on delete cascade,
  revision integer not null check (revision >= 1),
  channel text not null check (channel in ('instagram', 'x', 'linkedin')),
  format text not null check (format in ('carousel', 'single', 'reel')),
  caption text not null check (btrim(caption) <> ''),
  media jsonb not null check (jsonb_typeof(media) = 'object'),
  asset_id uuid references public.assets (id) on delete set null,
  social_post_id uuid references public.social_posts (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint proposed_post_channels_key unique (post_id, revision, channel)
);
create index proposed_post_channels_social_idx on public.proposed_post_channels (social_post_id)
  where social_post_id is not null;
create index proposed_post_channels_asset_idx on public.proposed_post_channels (asset_id) where asset_id is not null;

-- Each revision sent back: what it held, who asked for another and why.
create table public.proposed_post_revisions (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.proposed_posts (id) on delete cascade,
  revision integer not null check (revision >= 1),
  reason text not null check (reason in ('rejected', 'rerender')),
  note text not null check (btrim(note) <> ''),
  asked_by uuid references auth.users (id) on delete set null,
  asked_by_kind public.actor_kind not null,
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  created_at timestamptz not null default now(),
  constraint proposed_post_revisions_key unique (post_id, revision)
);
create index proposed_post_revisions_asked_by_idx on public.proposed_post_revisions (asked_by);

-- The social_posts rule (architecture 3.7): every staff role reads; the rows are written only through the functions of
-- the fn migration, under the service role, and never deleted. Retention follows social_posts: kept.
alter table public.proposed_posts enable row level security;
revoke all on table public.proposed_posts from anon, authenticated;
grant select on table public.proposed_posts to authenticated;
grant all on table public.proposed_posts to service_role;
create policy proposed_posts_select_staff on public.proposed_posts for select to authenticated using (app.is_staff());

alter table public.proposed_post_channels enable row level security;
revoke all on table public.proposed_post_channels from anon, authenticated;
grant select on table public.proposed_post_channels to authenticated;
grant all on table public.proposed_post_channels to service_role;
create policy proposed_post_channels_select_staff on public.proposed_post_channels for select to authenticated
  using (app.is_staff());

alter table public.proposed_post_revisions enable row level security;
revoke all on table public.proposed_post_revisions from anon, authenticated;
grant select on table public.proposed_post_revisions to authenticated;
grant all on table public.proposed_post_revisions to service_role;
create policy proposed_post_revisions_select_staff on public.proposed_post_revisions for select to authenticated
  using (app.is_staff());

-- Item 1 has not landed: a brand post's asset has no property (H107 made `assets.property_id` nullable), so its
-- `social_posts` row has none either (H135).
alter table public.social_posts alter column property_id drop not null;
