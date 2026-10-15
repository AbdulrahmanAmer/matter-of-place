-- down:
--   drop index if exists public.social_posts_brand_idx;
--   drop index if exists public.assets_brand_kind_revision_key;
--   alter table public.social_posts drop constraint if exists social_posts_subject_shape;
--   alter table public.assets drop constraint if exists assets_subject_shape;
--   delete from public.social_posts where subject = 'brand';
--   delete from public.assets where subject = 'brand';
--   alter table public.social_posts alter column property_id set not null;
--   alter table public.assets alter column property_id set not null;
--   alter table public.social_posts drop column brand_key, drop column subject;
--   alter table public.assets drop column brand_key, drop column subject;
--   drop type public.asset_subject;
set lock_timeout = '5s';

-- W8 item 1 (operator, 2026-10-15): something to post before the first listing. A visual is about a property or about
-- the brand (a coming-soon post, a market note, an editorial card); a brand visual names its entry in the brand
-- catalog (src/domain/brand-posts.ts) by `brand_key` and has no property. Every existing row is a property's and every
-- existing query filters by property_id, so it keeps working (expand only; workspace/05-plans/W8-brand-design.md).
create type public.asset_subject as enum ('property', 'brand');

alter table public.assets
  add column subject public.asset_subject not null default 'property',
  add column brand_key text;
alter table public.assets alter column property_id drop not null;
alter table public.assets add constraint assets_subject_shape check (
  (subject = 'property' and property_id is not null and brand_key is null)
  or (subject = 'brand' and property_id is null and brand_key is not null
      and brand_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
-- `brand_key is not null` is explicit: a check passes on null, and `null ~ pattern` is null (dry run, 2026-10-15).
-- The property key (property_id, kind, revision) holds for property rows; a brand row's twin is its key, kind, revision.
create unique index assets_brand_kind_revision_key on public.assets (brand_key, kind, revision)
where subject = 'brand';

-- A post copies its visual's subject, so the posting path and the reports know what it is about.
alter table public.social_posts
  add column subject public.asset_subject not null default 'property',
  add column brand_key text;
alter table public.social_posts alter column property_id drop not null;
alter table public.social_posts add constraint social_posts_subject_shape check (
  (subject = 'property' and property_id is not null and brand_key is null)
  or (subject = 'brand' and property_id is null and brand_key is not null
      and brand_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
create index social_posts_brand_idx on public.social_posts (brand_key) where subject = 'brand';
