-- down:
--   delete from public.settings where key = 'products';
--   drop trigger settings_bump_catalog_version on public.settings;
--   drop trigger settings_bump_catalog_version_del on public.settings;
--   create trigger settings_bump_catalog_version
--   after insert or update on public.settings
--   for each row when (new.key in ('flags', 'coming_soon_global', 'site', 'environment', 'og_static'))
--   execute function public.tg_bump_catalog_version();
--   create trigger settings_bump_catalog_version_del
--   after delete on public.settings
--   for each row when (old.key in ('flags', 'coming_soon_global', 'site', 'environment', 'og_static'))
--   execute function public.tg_bump_catalog_version();
--   and the seven-key public_state() again, as supabase/sql/functions/public_state.sql held it before this file:
--   create or replace function public.public_state()
--   returns jsonb
--   language sql
--   stable
--   security definer
--   set search_path = ''
--   as $$
--     select jsonb_build_object(
--       'catalog_version', (select s.value from public.settings s where s.key = 'catalog_version'),
--       'flags', coalesce((select s.value from public.settings s where s.key = 'flags'), '{}'::jsonb),
--       'coming_soon_global', (select s.value from public.settings s where s.key = 'coming_soon_global'),
--       'coming_soon_markets', coalesce(
--         (select jsonb_object_agg(m.slug, m.coming_soon) from public.markets m),
--         '{}'::jsonb
--       ),
--       'site', (
--         select jsonb_build_object('contact', s.value -> 'contact', 'legal', s.value -> 'legal', 'social', s.value -> 'social')
--         from public.settings s
--         where s.key = 'site'
--       ),
--       'illustrative_content', coalesce(
--         (select s.value #>> '{}' in ('development', 'preview') from public.settings s where s.key = 'environment'),
--         false
--       ),
--       'og_static', coalesce((select s.value from public.settings s where s.key = 'og_static'), '{}'::jsonb)
--     )
--   $$;
set lock_timeout = '5s';

-- H80: the Property Exposure plans are a setting an owner edits without a deploy. `products` is a public key (a page
-- renders it), so it joins the key list of the two triggers that raise catalog_version (P-041, G21). The triggers
-- are dropped and created again because the `when` of a trigger cannot be altered.
drop trigger settings_bump_catalog_version on public.settings;
drop trigger settings_bump_catalog_version_del on public.settings;
create trigger settings_bump_catalog_version
after insert or update on public.settings
for each row when (new.key in ('flags', 'coming_soon_global', 'site', 'environment', 'og_static', 'products'))
execute function public.tg_bump_catalog_version();
create trigger settings_bump_catalog_version_del
after delete on public.settings
for each row when (old.key in ('flags', 'coming_soon_global', 'site', 'environment', 'og_static', 'products'))
execute function public.tg_bump_catalog_version();

-- G39 amended by H80: public_state() has eight keys; `products` is the stored value, null when the row is missing.
create or replace function public.public_state()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'catalog_version', (select s.value from public.settings s where s.key = 'catalog_version'),
    'flags', coalesce((select s.value from public.settings s where s.key = 'flags'), '{}'::jsonb),
    'coming_soon_global', (select s.value from public.settings s where s.key = 'coming_soon_global'),
    'coming_soon_markets', coalesce(
      (select jsonb_object_agg(m.slug, m.coming_soon) from public.markets m),
      '{}'::jsonb
    ),
    'site', (
      select jsonb_build_object('contact', s.value -> 'contact', 'legal', s.value -> 'legal', 'social', s.value -> 'social')
      from public.settings s
      where s.key = 'site'
    ),
    'illustrative_content', coalesce(
      (select s.value #>> '{}' in ('development', 'preview') from public.settings s where s.key = 'environment'),
      false
    ),
    'og_static', coalesce((select s.value from public.settings s where s.key = 'og_static'), '{}'::jsonb),
    'products', (select s.value from public.settings s where s.key = 'products')
  )
$$;

-- The seed is the four rows of `offerings` in src/data/exposure.ts with each price in whole dollars;
-- tests/unit/products-seed.test.ts requires this literal to equal them. A replay conflicts and changes nothing, so it
-- never overwrites an edit. A first insert fires the trigger above once, so the plans reach the next read.
insert into public.settings (key, value)
values (
  'products',
  '{
  "plans": [
    {
      "id": "feature",
      "name": "The Feature",
      "price": 295,
      "line": "Editorial presence.",
      "note": null,
      "items": [
        "Dedicated Matter of Place property page",
        "Professionally edited editorial narrative",
        "Architecture, design and location context",
        "Curated image sequencing",
        "Matter of Place social carousel",
        "Collaborator invitation where applicable",
        "Agent or brokerage attribution",
        "Direct inquiry routing",
        "Search-indexable permanent URL",
        "Placement in the California, New York or Florida collection"
      ],
      "cta": "Submit a Property",
      "recommended": false
    },
    {
      "id": "reach",
      "name": "The Reach",
      "price": 695,
      "line": "Editorial presence, expanded through precision distribution.",
      "note": null,
      "items": [
        "Everything in The Feature",
        "Matter of Place Stories",
        "Newsletter inclusion",
        "Priority editorial scheduling",
        "Homepage or market-page rotation",
        "Additional social distribution",
        "Programmatic campaign planning",
        "Audience-targeting setup",
        "Campaign reporting framework",
        "Option to add programmatic media spend"
      ],
      "cta": "Expand the Reach",
      "recommended": true
    },
    {
      "id": "campaign",
      "name": "The Campaign",
      "price": 1495,
      "line": "A deeper, multi-channel property campaign.",
      "note": "Recommended media investment: $500 to $2,500+",
      "items": [
        "Everything in The Reach",
        "Deeper editorial research and an expanded property story",
        "Multi-post editorial treatment",
        "Short-form video or reel from supplied assets",
        "Standalone property email",
        "Priority homepage positioning",
        "A 10 to 14 day campaign window",
        "Multiple creative variants where appropriate",
        "Programmatic media and retargeting strategy",
        "Campaign optimization and post-campaign reporting"
      ],
      "cta": "Build a Campaign",
      "recommended": false
    },
    {
      "id": "five-features",
      "name": "Five Features",
      "price": 1250,
      "line": "For agents, teams and brokerages with several qualifying properties.",
      "note": "$250 per property",
      "items": [
        "Five Feature credits",
        "No expiration during the initial launch period",
        "Submit properties individually",
        "Every property remains subject to editorial approval",
        "Declined properties do not use a credit",
        "Distribution upgrades available per property"
      ],
      "cta": "Secure Five Features",
      "recommended": false
    }
  ]
}'::jsonb
)
on conflict (key) do nothing;
