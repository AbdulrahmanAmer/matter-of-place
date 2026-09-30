-- Matter of Place: Postgres schema for Supabase.
--
-- Column names mirror src/domain/*.ts in snake_case. Public reads go through
-- the API with the service role; RLS therefore denies everything to anon and
-- grants editors (Supabase Auth users with an editor role) full access.
-- Apply with: supabase db push, or paste into the SQL editor.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- enums

create type property_type as enum (
  'Estate', 'Residence', 'Townhouse', 'Waterfront', 'Farmhouse', 'Apartment', 'Penthouse'
);
create type listing_status as enum ('Illustrative', 'Active', 'Off-market', 'Under offer', 'Sold');
create type campaign_tier as enum ('Editorial', 'Feature', 'Reach', 'Campaign');
create type submission_source as enum ('Editorial', 'Submission');
create type editorial_state as enum ('draft', 'review', 'published', 'archived');
create type media_orientation as enum ('landscape', 'portrait');

create type story_category as enum ('Architecture', 'Interiors', 'Places', 'Stories');

create type inquiry_intent as enum (
  'showing', 'ask', 'similar', 'sell', 'invest', 'agent', 'general'
);
create type inquiry_state as enum ('new', 'in_progress', 'forwarded', 'closed');

create type accepted_state as enum ('California', 'New York', 'Florida');
create type exposure_package as enum ('The Feature', 'The Reach', 'The Campaign', 'Five Features', 'Not sure yet');
-- Internal workflow; never exposed publicly.
create type submission_state as enum (
  'Submitted', 'Under Review', 'Accepted', 'Declined', 'Awaiting Assets',
  'Awaiting Payment', 'Scheduled', 'Published', 'Distribution Active', 'Completed'
);
create type channel_status as enum ('none', 'planned', 'active', 'done');
-- Editorial roles decide selection; commercial roles cannot bypass it.
create type app_role as enum (
  'chief_editorial_officer', 'managing_editor', 'visual_editor', 'contributor',
  'media_operations', 'commercial_partnerships', 'admin'
);

-- ---------------------------------------------------------------- roles
-- is_editor(): any internal role (read/write access to workspace tables).
-- can_select(): only editorial leadership may accept or decline.

create table user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  role app_role not null,
  unique (user_id, role)
);

create or replace function has_role(_user_id uuid, _role app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from user_roles where user_id = _user_id and role = _role);
$$;

create or replace function can_select()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from user_roles
     where user_id = auth.uid()
       and role in ('chief_editorial_officer', 'managing_editor', 'admin')
  );
$$;

create or replace function is_editor()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from user_roles
     where user_id = auth.uid()
       and role in ('chief_editorial_officer', 'managing_editor', 'visual_editor', 'contributor',
                    'media_operations', 'commercial_partnerships', 'admin')
  );
$$;

-- ---------------------------------------------------------------- catalog

create table markets (
  slug text primary key,
  name text not null,
  country text not null,
  currency char(3) not null default 'USD',
  intro text not null,
  places text[] not null default '{}',
  image text not null,
  sort_order int not null default 0,
  editorial_state editorial_state not null default 'draft',
  updated_at timestamptz not null default now()
);

create table regions (
  slug text primary key,
  market_slug text not null references markets (slug) on delete cascade,
  name text not null,
  intro text not null,
  places text[] not null default '{}',
  image text not null,
  sort_order int not null default 0
);
create index regions_market_idx on regions (market_slug, sort_order);

-- "How we read this market": label + paragraph, ordered.
create table market_notes (
  id uuid primary key default gen_random_uuid(),
  market_slug text not null references markets (slug) on delete cascade,
  label text not null,
  text text not null,
  sort_order int not null default 0
);

-- Guide sections: neighborhoods (with region), client needs, local service.
create table market_guide_entries (
  id uuid primary key default gen_random_uuid(),
  market_slug text not null references markets (slug) on delete cascade,
  section text not null check (section in ('neighborhood', 'need', 'service')),
  region_slug text references regions (slug) on delete set null,
  label text not null,
  text text not null,
  sort_order int not null default 0
);

create table representatives (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  brokerage text not null,
  license text,
  email text,
  phone text,
  photo text,
  created_at timestamptz not null default now()
);

create table properties (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  market_slug text not null references markets (slug),
  region_slug text not null references regions (slug),
  city text not null,
  neighborhood text not null,
  state text not null,
  country text not null,
  address text not null,
  coordinates point,
  price bigint not null check (price > 0),
  currency char(3) not null default 'USD',
  beds int not null,
  baths numeric(3, 1) not null,
  interior_sq_ft int not null,
  lot_acres numeric(8, 2) not null,
  year_built int not null,
  type property_type not null,
  style text not null,
  architect text,
  designer text,
  status listing_status not null default 'Illustrative',
  hero_image text not null,
  video_src text,
  video_poster text,
  video_caption text,
  video_duration text,
  story text[] not null default '{}',
  place text not null,
  representative_id uuid references representatives (id) on delete set null,
  listing_url text,
  hero_rank int,
  featured_rank int,
  campaign_tier campaign_tier not null default 'Editorial',
  source submission_source not null default 'Editorial',
  editorial_state editorial_state not null default 'draft',
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((editorial_state = 'published') = (published_at is not null))
);
create index properties_published_idx on properties (editorial_state, published_at desc);
create index properties_market_idx on properties (market_slug, region_slug);
create unique index properties_hero_rank_idx on properties (hero_rank) where hero_rank is not null;
create unique index properties_featured_rank_idx on properties (featured_rank) where featured_rank is not null;

create table property_media (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties (id) on delete cascade,
  src text not null,
  alt text not null,
  orientation media_orientation not null,
  sort_order int not null default 0
);
create index property_media_idx on property_media (property_id, sort_order);

create table property_features (
  property_id uuid not null references properties (id) on delete cascade,
  feature text not null,
  sort_order int not null default 0,
  primary key (property_id, feature)
);

create table property_related (
  property_id uuid not null references properties (id) on delete cascade,
  related_slug text not null,
  sort_order int not null default 0,
  primary key (property_id, related_slug)
);

create table stories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  deck text not null,
  category story_category not null,
  market_slug text not null references markets (slug),
  image text not null,
  body text[] not null default '{}',
  properties text[] not null default '{}',
  editorial_state editorial_state not null default 'draft',
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((editorial_state = 'published') = (published_at is not null))
);

-- Bumped by trigger whenever published catalog content changes; the API uses
-- it in cache keys (see docs/architecture/caching.md).
create table settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
insert into settings (key, value) values ('catalog_version', '1');

create or replace function bump_catalog_version()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update settings
     set value = (value::bigint + 1)::text, updated_at = now()
   where key = 'catalog_version';
  return null;
end;
$$;

create trigger properties_catalog_version
  after insert or update or delete on properties
  for each statement execute function bump_catalog_version();
create trigger stories_catalog_version
  after insert or update or delete on stories
  for each statement execute function bump_catalog_version();
create trigger markets_catalog_version
  after insert or update or delete on markets
  for each statement execute function bump_catalog_version();
create trigger regions_catalog_version
  after insert or update or delete on regions
  for each statement execute function bump_catalog_version();

-- ---------------------------------------------------------------- writes

create table inquiries (
  id uuid primary key default gen_random_uuid(),
  intent inquiry_intent not null,
  topic text,
  subject_kind text check (subject_kind in ('property')),
  subject_slug text,
  subject_title text,
  name text not null,
  email text not null,
  phone text,
  location text,
  message text not null,
  details jsonb not null default '{}'::jsonb,
  source_path text not null,
  state inquiry_state not null default 'new',
  forwarded_at timestamptz,
  received_at timestamptz not null default now(),
  ip_hash text
);
create index inquiries_received_idx on inquiries (received_at desc);
create index inquiries_subject_idx on inquiries (subject_kind, subject_slug);

create table submissions (
  id uuid primary key default gen_random_uuid(),
  address text not null,
  city text not null,
  state accepted_state not null,
  zip char(5) not null,
  listing_url text,
  source_url text,
  price bigint,
  currency char(3) not null default 'USD' check (currency = 'USD'),
  property_type property_type not null,
  beds int,
  baths numeric(3, 1),
  interior_sq_ft int,
  architect text,
  designer text,
  year_built int,
  year_renovated int,
  brokerage text not null,
  agent_name text not null,
  agent_email text not null,
  agent_phone text,
  photography_url text,
  video_url text,
  story text not null,
  significance text not null,
  package exposure_package not null,
  media_budget numeric(12, 2),
  rights_confirmed boolean not null check (rights_confirmed),
  source_path text not null,
  workflow_state submission_state not null default 'Submitted',
  accepted_by uuid references auth.users (id),
  accepted_at timestamptz,
  property_id uuid references properties (id) on delete set null,
  received_at timestamptz not null default now(),
  reviewed_at timestamptz,
  ip_hash text
);

-- Editorial gate: a submission reaches any commercial or publishing state only
-- after acceptance, and only editorial leadership may accept or decline.
create or replace function enforce_editorial_gate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.workflow_state is distinct from old.workflow_state then
    if new.workflow_state in ('Accepted', 'Declined') and not can_select()
       and current_setting('role', true) <> 'service_role' then
      raise exception 'Only editorial leadership may accept or decline a submission';
    end if;
    if new.workflow_state in ('Awaiting Assets', 'Awaiting Payment', 'Scheduled', 'Published',
                              'Distribution Active', 'Completed')
       and new.accepted_at is null then
      raise exception 'Submission must be accepted before %', new.workflow_state;
    end if;
    if new.workflow_state = 'Accepted' then
      new.accepted_at := coalesce(new.accepted_at, now());
      new.accepted_by := coalesce(new.accepted_by, auth.uid());
    end if;
  end if;
  return new;
end;
$$;

create trigger submissions_editorial_gate
  before update on submissions
  for each row execute function enforce_editorial_gate();

create index submissions_received_idx on submissions (received_at desc);

create table submission_media (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references submissions (id) on delete cascade,
  name text not null,
  size bigint not null,
  type text not null,
  storage_path text not null,
  uploaded_at timestamptz
);
create index submission_media_idx on submission_media (submission_id);

-- One campaign per accepted property and product. Placement and channel
-- statuses are internal; media spend is billed separately from the package.
create table campaigns (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties (id) on delete cascade,
  submission_id uuid references submissions (id) on delete set null,
  package exposure_package not null,
  media_budget numeric(12, 2) not null default 0,
  management_fee numeric(12, 2) generated always as (
    case when media_budget > 0 then greatest(media_budget * 0.15, 100) else 0 end
  ) stored,
  starts_on date,
  ends_on date,
  homepage_status channel_status not null default 'none',
  featured_status channel_status not null default 'none',
  newsletter_status channel_status not null default 'none',
  social_status channel_status not null default 'none',
  programmatic_status channel_status not null default 'none',
  created_at timestamptz not null default now()
);

-- Simple client report for paid campaigns.
create table campaign_reports (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns (id) on delete cascade,
  period_start date not null,
  period_end date not null,
  media_spend numeric(12, 2) not null default 0,
  impressions bigint not null default 0,
  reach bigint not null default 0,
  clicks bigint not null default 0,
  video_views bigint,
  ctr numeric(6, 4),
  geography jsonb not null default '{}'::jsonb,
  channel_mix jsonb not null default '{}'::jsonb,
  owned_distribution jsonb not null default '{}'::jsonb,
  top_creative text,
  created_at timestamptz not null default now()
);
create index campaign_reports_idx on campaign_reports (campaign_id, period_start);

create table subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  source text not null,
  confirmed_at timestamptz,
  unsubscribed_at timestamptz,
  created_at timestamptz not null default now()
);

create table analytics_events (
  id bigint generated always as identity primary key,
  event text not null,
  path text not null,
  data jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now()
);
create index analytics_events_idx on analytics_events (event, occurred_at desc);

-- ---------------------------------------------------------------- views

-- Convenience view for the API: one row per published property with nested
-- media, features and related slugs already aggregated.
create or replace view published_properties as
select
  p.*,
  coalesce((
    select jsonb_agg(jsonb_build_object('src', m.src, 'alt', m.alt, 'orientation', m.orientation)
                     order by m.sort_order)
    from property_media m where m.property_id = p.id), '[]'::jsonb) as gallery,
  coalesce((
    select array_agg(f.feature order by f.sort_order)
    from property_features f where f.property_id = p.id), '{}') as features,
  coalesce((
    select array_agg(r.related_slug order by r.sort_order)
    from property_related r where r.property_id = p.id), '{}') as related,
  case when rep.id is null then null else jsonb_build_object(
    'name', rep.name, 'brokerage', rep.brokerage, 'license', rep.license,
    'email', rep.email, 'phone', rep.phone, 'photo', rep.photo) end as representation
from properties p
left join representatives rep on rep.id = p.representative_id
where p.editorial_state = 'published';

-- ---------------------------------------------------------------- grants and RLS

-- The API uses the service role, which bypasses RLS. Editors use Supabase
-- Auth from Studio or an admin surface. Anonymous access is denied everywhere.
grant usage on schema public to authenticated, service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

do $$
declare t text;
begin
  for t in
    select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy "editors manage %1$s" on public.%1$I for all to authenticated using (is_editor()) with check (is_editor())',
      t
    );
  end loop;
end $$;

-- user_roles: editors may read, only admins may change.
drop policy "editors manage user_roles" on user_roles;
create policy "editors read roles" on user_roles for select to authenticated using (is_editor());
create policy "admins manage roles" on user_roles for all to authenticated
  using (has_role(auth.uid(), 'admin')) with check (has_role(auth.uid(), 'admin'));

-- ---------------------------------------------------------------- storage

-- Bucket for submitted photography. Private; the API issues signed upload
-- URLs and editors read through Studio.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('submissions', 'submissions', false, 26214400, array['image/jpeg', 'image/png', 'image/heic', 'image/webp'])
on conflict (id) do nothing;

-- Public bucket for published photography (or use R2; see caching.md).
insert into storage.buckets (id, name, public)
values ('media', 'media', true)
on conflict (id) do nothing;
