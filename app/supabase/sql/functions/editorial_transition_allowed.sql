create or replace function public.editorial_transition_allowed(
  p_from public.editorial_state,
  p_to public.editorial_state
)
returns boolean
language sql
immutable
security definer
set search_path = ''
as $$
  select (p_from::text, p_to::text) in (
    ('draft', 'review'),
    ('draft', 'agent_review'),
    ('draft', 'archived'),
    ('review', 'draft'),
    ('review', 'agent_review'),
    ('review', 'published'),
    ('review', 'archived'),
    ('agent_review', 'review'),
    ('agent_review', 'draft'),
    ('agent_review', 'published'),
    ('agent_review', 'archived'),
    ('published', 'archived'),
    ('archived', 'draft')
  );
$$;
