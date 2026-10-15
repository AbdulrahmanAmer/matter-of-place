-- down:
--   delete from public.assets where subject <> 'property';
--   alter table public.assets drop constraint assets_subject_columns;
--   alter table public.assets alter column property_id set not null;
--   drop index if exists public.assets_market_slug_idx;
--   drop index if exists public.assets_story_idx;
--   alter table public.assets drop column story_id, drop column market_slug, drop column subject;
set lock_timeout = '5s';

-- W7 item 19 (ruling H107): a reel a colleague or Matter asks for may be about a market, a story or the brand, not a
-- property. Every existing row is a property's; the new columns default to that, so the running Worker reads the same.
alter table public.assets
  add column subject text not null default 'property'
    check (subject in ('property', 'market', 'story', 'brand')),
  add column market_slug text references public.markets (slug) on delete cascade,
  add column story_id uuid references public.stories (id) on delete cascade;

alter table public.assets alter column property_id drop not null;

-- The subject names exactly the column it is about; a brand asset names none.
alter table public.assets add constraint assets_subject_columns check (
  case subject
    when 'property' then property_id is not null and market_slug is null and story_id is null
    when 'market' then property_id is null and market_slug is not null and story_id is null
    when 'story' then property_id is null and market_slug is null and story_id is not null
    else property_id is null and market_slug is null and story_id is null
  end
);

create index assets_market_slug_idx on public.assets (market_slug) where market_slug is not null;
create index assets_story_idx on public.assets (story_id) where story_id is not null;
