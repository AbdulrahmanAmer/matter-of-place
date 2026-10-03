-- down:
--   drop table public.retention_policies, public.redirects, public.slug_history, public.settings, public.stories,
--     public.property_related, public.property_features, public.property_media, public.properties,
--     public.representatives, public.market_guide_entries, public.market_notes, public.regions, public.markets;
--   drop function public.sync_property_hero_image(), public.property_media_orientation();
--   delete from public.pii_columns where table_name = 'representatives';
set lock_timeout = '5s';

-- Sketch columns (docs/database/schema.sql at 8dd6f26) changed as B2 Data changes item 4 lists. Every image column
-- holds a key in the `media` bucket, never a URL (ruling H33). Every table has created_at and updated_at with its
-- `<table>_set_updated_at` trigger, except slug_history, whose rows are never updated.

-- Invariant 7: no other market. A market's public state is `coming_soon` alone (architecture 11).
create table public.markets (
  slug text primary key check (slug in ('california', 'new-york', 'florida')),
  name text not null,
  country text not null,
  currency char(3) not null default 'USD',
  intro text not null,
  places text[] not null default '{}',
  -- G55: null until render_variants writes it; image_variants is written in the same update (G42).
  image text,
  image_variants jsonb not null default '{}',
  sort_order int not null default 0,
  coming_soon boolean not null default true,
  interest_copy text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.regions (
  slug text primary key,
  market_slug text not null references public.markets (slug) on delete cascade,
  name text not null,
  intro text not null,
  places text[] not null default '{}',
  image text,
  image_variants jsonb not null default '{}',
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- The target of the composite foreign key of properties (invariant 6).
  constraint regions_slug_market_slug_key unique (slug, market_slug)
);
create index regions_market_idx on public.regions (market_slug, sort_order);

create table public.market_notes (
  id uuid primary key default gen_random_uuid(),
  market_slug text not null references public.markets (slug) on delete cascade,
  label text not null,
  text text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index market_notes_market_idx on public.market_notes (market_slug, sort_order);

create table public.market_guide_entries (
  id uuid primary key default gen_random_uuid(),
  market_slug text not null references public.markets (slug) on delete cascade,
  section text not null check (section in ('neighborhood', 'need', 'service')),
  region_slug text references public.regions (slug) on delete set null,
  label text not null,
  text text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index market_guide_entries_market_idx on public.market_guide_entries (market_slug, sort_order);
create index market_guide_entries_region_idx on public.market_guide_entries (region_slug);

-- `photo` is written only by scripts/seed.ts (G56).
create table public.representatives (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  brokerage text not null,
  license text,
  email text,
  phone text,
  photo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- A draft may be incomplete (G62): B7's create_property_from_submission makes one from a request, and
-- enforce_publish_gate (migration 8) keeps a published row complete. A null region_slug skips the composite foreign
-- key (match simple); a null price passes `price > 0`.
create table public.properties (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  market_slug text not null references public.markets (slug) on delete restrict,
  region_slug text,
  city text not null,
  neighborhood text,
  state text not null,
  country text,
  address text not null,
  coordinates point,
  price numeric(12, 2) check (price > 0),
  currency char(3) not null default 'USD' check (currency = 'USD'),
  beds int,
  baths numeric(3, 1),
  interior_sq_ft int,
  lot_acres numeric(8, 2),
  year_built int,
  type public.property_type not null,
  style text,
  architect text,
  designer text,
  status public.listing_status not null default 'Illustrative',
  -- G66: written only by the trigger property_media_hero_image.
  hero_image text,
  -- The domain PropertyVideo {src, poster, caption, duration}, replacing the sketch's four video_* columns (G-004);
  -- written by B12's attach_reel.
  video jsonb check (video is null or jsonb_typeof(video) = 'object'),
  story text[] not null default '{}',
  place text,
  representative_id uuid references public.representatives (id) on delete set null,
  listing_url text,
  hero_rank int,
  featured_rank int,
  campaign_tier public.campaign_tier not null default 'Editorial',
  source public.submission_source not null default 'Editorial',
  -- The foreign key is added by migration 5, which creates submissions.
  submission_id uuid,
  -- Invariant 22 (S55).
  presented_by_owner boolean not null default false,
  -- G6: written only by B9's approve_asset.
  og_image_key text,
  editorial_state public.editorial_state not null default 'draft',
  published_at timestamptz,
  -- Invariant 11: set by enforce_slug_immutable (migration 8), never cleared.
  first_published_at timestamptz,
  archived_at timestamptz,
  -- Invariant 12 and G23: written only by B7's takedown and unpublish_property.
  taken_down_at timestamptz,
  unpublish_reason text,
  unpublished_at timestamptz,
  -- Invariant 10: bumped by properties_version_bump (migration 8).
  version int not null default 1 check (version >= 1),
  -- Invariant 15: a new nonce revokes every outstanding preview link.
  preview_nonce uuid not null default gen_random_uuid(),
  -- Text columns only: enum casts and array_to_string are not immutable. No public request reads it (invariant 16).
  search_text tsvector generated always as (
    to_tsvector(
      'english',
      coalesce(title, '') || ' ' || coalesce(city, '') || ' ' || coalesce(neighborhood, '') || ' '
        || coalesce(state, '') || ' ' || coalesce(style, '') || ' ' || coalesce(architect, '') || ' '
        || coalesce(designer, '') || ' ' || coalesce(place, '') || ' ' || coalesce(address, '')
    )
  ) stored,
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Invariant 6: a mismatch raises 23503.
  constraint properties_region_market_fkey foreign key (region_slug, market_slug)
    references public.regions (slug, market_slug) on delete restrict,
  -- The pattern is slugPattern of src/domain/contracts.ts.
  constraint properties_slug_format check (slug ~ '^(__e2e-)?[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 120),
  constraint properties_published_pairing check ((editorial_state = 'published') = (published_at is not null)),
  constraint properties_archived_pairing check ((editorial_state = 'archived') = (archived_at is not null))
);
create index properties_published_idx on public.properties (editorial_state, published_at desc);
create index properties_market_idx on public.properties (market_slug, region_slug);
create index properties_region_idx on public.properties (region_slug, market_slug);
create index properties_representative_idx on public.properties (representative_id);
create index properties_created_by_idx on public.properties (created_by);
create index properties_updated_by_idx on public.properties (updated_by);
create index properties_search_text_idx on public.properties using gin (search_text);
create unique index properties_hero_rank_key on public.properties (hero_rank) where hero_rank is not null;
create unique index properties_featured_rank_key on public.properties (featured_rank) where featured_rank is not null;
-- DL-02: one property per submission.
create unique index properties_submission_id_key on public.properties (submission_id) where submission_id is not null;

-- A photograph is staged (staging_path, the unstripped original in the private bucket `submissions`) until B9's
-- render_variants stores it (media_key, its stripped master in `media`) and clears staging_path (G25, G42).
create table public.property_media (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties (id) on delete cascade,
  media_key text,
  staging_path text,
  variants jsonb not null default '{}',
  alt text,
  orientation public.media_orientation,
  sort_order int not null default 0,
  -- PERF-01: the render_variants job that claimed this staged row. No foreign key: jobs is B8's table.
  render_job_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint property_media_staged_or_stored check (media_key is not null or staging_path is not null),
  -- The snapshot carries only stored rows, and each has an orientation.
  constraint property_media_orientation_when_stored check (media_key is null or orientation is not null)
);
create index property_media_idx on public.property_media (property_id, sort_order);

create table public.property_features (
  property_id uuid not null references public.properties (id) on delete cascade,
  feature text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (property_id, feature)
);

create table public.property_related (
  property_id uuid not null references public.properties (id) on delete cascade,
  related_slug text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (property_id, related_slug)
);

create table public.stories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  deck text not null,
  category public.story_category not null,
  market_slug text not null references public.markets (slug) on delete restrict,
  -- G55: B7's publish_story refuses while it is null.
  image text,
  image_variants jsonb not null default '{}',
  body text[] not null default '{}',
  properties text[] not null default '{}',
  editorial_state public.editorial_state not null default 'draft',
  published_at timestamptz,
  archived_at timestamptz,
  author_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stories_published_pairing check ((editorial_state = 'published') = (published_at is not null)),
  constraint stories_archived_pairing check ((editorial_state = 'archived') = (archived_at is not null))
);
create index stories_market_idx on public.stories (market_slug);
create index stories_author_idx on public.stories (author_id);

-- Rows are seeded by migration 12 and the slices that read them (architecture 3.1).
create table public.settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);
create index settings_updated_by_idx on public.settings (updated_by);

-- Invariant 11: the old slugs of a renamed draft, answered with a 301.
create table public.slug_history (
  slug text primary key,
  property_id uuid not null references public.properties (id) on delete cascade,
  changed_at timestamptz not null default now(),
  constraint slug_history_slug_format check (slug ~ '^(__e2e-)?[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 120)
);
create index slug_history_property_idx on public.slug_history (property_id);

create table public.redirects (
  id uuid primary key default gen_random_uuid(),
  from_path text not null,
  to_path text not null,
  status smallint not null default 301 check (status in (301, 302, 307, 308)),
  enabled boolean not null default true,
  note text,
  -- B7's archive_redirect sets it and enabled = false.
  archived_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint redirects_paths_absolute check (starts_with(from_path, '/') and starts_with(to_path, '/')),
  constraint redirects_not_to_itself check (from_path <> to_path),
  constraint redirects_from_path_public check (
    not starts_with(from_path, '/api/') and not starts_with(from_path, '/admin')
  ),
  constraint redirects_archived_disabled check (archived_at is null or not enabled)
);
-- An archived source can be added again.
create unique index redirects_from_path_active_key on public.redirects (from_path) where archived_at is null;
create index redirects_created_by_idx on public.redirects (created_by);

-- A null keep_for keeps rows forever. Rows are seeded by migration 12 and by the slices that own the tables.
create table public.retention_policies (
  key text primary key,
  table_name text not null,
  keep_for interval,
  action text not null check (action in ('delete', 'anonymise', 'keep')),
  enabled boolean not null default true,
  note text,
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
create index retention_policies_updated_by_idx on public.retention_policies (updated_by);

create trigger markets_set_updated_at
before update on public.markets
for each row execute function public.set_updated_at();
create trigger regions_set_updated_at
before update on public.regions
for each row execute function public.set_updated_at();
create trigger market_notes_set_updated_at
before update on public.market_notes
for each row execute function public.set_updated_at();
create trigger market_guide_entries_set_updated_at
before update on public.market_guide_entries
for each row execute function public.set_updated_at();
create trigger representatives_set_updated_at
before update on public.representatives
for each row execute function public.set_updated_at();
-- DB-16: the name sorts before properties_version_bump (migration 8).
create trigger properties_set_updated_at
before update on public.properties
for each row execute function public.set_updated_at();
create trigger property_media_set_updated_at
before update on public.property_media
for each row execute function public.set_updated_at();
create trigger property_features_set_updated_at
before update on public.property_features
for each row execute function public.set_updated_at();
create trigger property_related_set_updated_at
before update on public.property_related
for each row execute function public.set_updated_at();
create trigger stories_set_updated_at
before update on public.stories
for each row execute function public.set_updated_at();
create trigger settings_set_updated_at
before update on public.settings
for each row execute function public.set_updated_at();
create trigger redirects_set_updated_at
before update on public.redirects
for each row execute function public.set_updated_at();
create trigger retention_policies_set_updated_at
before update on public.retention_policies
for each row execute function public.set_updated_at();

-- G63: orientation follows the stored hero variant, so B9's apply_media_variants needs no orientation argument.
create or replace function public.property_media_orientation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.variants is not distinct from old.variants then
      return new;
    end if;
  end if;
  if new.variants ? 'hero' then
    new.orientation := case
      when (new.variants -> 'hero' ->> 'h')::int > (new.variants -> 'hero' ->> 'w')::int
        then 'portrait'::public.media_orientation
      else 'landscape'::public.media_orientation
    end;
  end if;
  return new;
end;
$$;

create trigger property_media_orientation
before insert or update of variants on public.property_media
for each row execute function public.property_media_orientation();

-- G66: properties.hero_image is the media_key of the property's first photograph in sequence, null while that
-- photograph is staged. This trigger is its only writer; hero_image is a system column (DB-16).
create or replace function public.sync_property_hero_image()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_property_id uuid;
  v_key text;
begin
  if tg_op = 'INSERT' then
    v_ids := array[new.property_id];
  elsif tg_op = 'DELETE' then
    v_ids := array[old.property_id];
  else
    v_ids := array[old.property_id, new.property_id];
  end if;
  foreach v_property_id in array v_ids loop
    select m.media_key into v_key
    from public.property_media m
    where m.property_id = v_property_id
    order by m.sort_order, m.id
    limit 1;
    update public.properties
    set hero_image = v_key
    where id = v_property_id
      and hero_image is distinct from v_key;
  end loop;
  return null;
end;
$$;

create trigger property_media_hero_image
after insert or delete or update of media_key, sort_order, property_id on public.property_media
for each row execute function public.sync_property_hero_image();

revoke execute on function public.property_media_orientation(), public.sync_property_hero_image()
from public, anon, authenticated;

alter table public.markets enable row level security;
alter table public.regions enable row level security;
alter table public.market_notes enable row level security;
alter table public.market_guide_entries enable row level security;
alter table public.representatives enable row level security;
alter table public.properties enable row level security;
alter table public.property_media enable row level security;
alter table public.property_features enable row level security;
alter table public.property_related enable row level security;
alter table public.stories enable row level security;
alter table public.settings enable row level security;
alter table public.slug_history enable row level security;
alter table public.redirects enable row level security;
alter table public.retention_policies enable row level security;
-- G-100: db:reset drops the schema's default privileges and a fresh stack still has them, so every grant is explicit
-- (invariant 1). The `authenticated` grants of the RLS matrix come with migration 10.
revoke all on table public.markets, public.regions, public.market_notes, public.market_guide_entries,
  public.representatives, public.properties, public.property_media, public.property_features,
  public.property_related, public.stories, public.settings, public.slug_history, public.redirects,
  public.retention_policies
from anon, authenticated;
grant all on table public.markets, public.regions, public.market_notes, public.market_guide_entries,
  public.representatives, public.properties, public.property_media, public.property_features,
  public.property_related, public.stories, public.settings, public.slug_history, public.redirects,
  public.retention_policies
to service_role;

-- Invariant 18: personal data never enters audit_log.
insert into public.pii_columns (table_name, column_name)
values ('representatives', 'email'), ('representatives', 'phone')
on conflict do nothing;
