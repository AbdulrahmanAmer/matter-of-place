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
    'og_static', coalesce((select s.value from public.settings s where s.key = 'og_static'), '{}'::jsonb)
  )
$$;
