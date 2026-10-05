-- down:
--   drop view public.archive_facets;
set lock_timeout = '5s';

-- B13 step 4: the database statement of the archive threshold. An archive page exists for a city (city and state,
-- `tiburon-ca`), an architect or a style that three or more published properties share. The Worker derives the same
-- facets in memory from the catalog snapshot (`src/server/seo/archive.ts`, `MIN_ARCHIVE`), so nothing reads this view on
-- a request; it is the reference for `tests/db/archive.db.test.ts`, which compares its rows with `listFacets`.
-- The view counts every published property, as the snapshot does before coming-soon and illustrative rules hide rows.
-- The slug mirrors `slugify` in `src/lib/slug.ts`: accents folded, apostrophes dropped, every other run of characters
-- that are not letters or digits one hyphen. The state of a city slug is `ca`, `ny` or `fl` for the three accepted states.
create view public.archive_facets
with (security_invoker = true) as
with facet_rows as (
  select
    'city'::text as kind,
    p.city || ', ' || p.state as label,
    p.city || ' ' || case p.state
      when 'California' then 'ca'
      when 'New York' then 'ny'
      when 'Florida' then 'fl'
      else p.state
    end as source
  from public.properties p
  where p.editorial_state = 'published'
  union all
  select 'architect'::text, p.architect, p.architect
  from public.properties p
  where p.editorial_state = 'published' and btrim(p.architect) <> ''
  union all
  select 'style'::text, p.style, p.style
  from public.properties p
  where p.editorial_state = 'published' and btrim(p.style) <> ''
),
slugged as (
  select
    f.kind,
    f.label,
    btrim(
      regexp_replace(
        regexp_replace(
          lower(regexp_replace(normalize(f.source, nfkd), '[\u0300-\u036f]', '', 'g')),
          '[''’]', '', 'g'
        ),
        '[^[:alnum:]]+', '-', 'g'
      ),
      '-'
    ) as slug
  from facet_rows f
)
select
  s.kind,
  s.slug,
  min(s.label collate "C") as label,
  count(*)::int as property_count
from slugged s
where s.slug <> ''
group by s.kind, s.slug
having count(*) >= 3;

-- G-100: the grants are stated. Nothing public reads it; only the service role does.
revoke all on public.archive_facets from public, anon, authenticated;
grant select on public.archive_facets to service_role;
