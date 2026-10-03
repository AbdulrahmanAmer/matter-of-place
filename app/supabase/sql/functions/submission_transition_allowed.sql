create or replace function public.submission_transition_allowed(
  p_from public.submission_state,
  p_to public.submission_state
)
returns boolean
language sql
immutable
security definer
set search_path = ''
as $$
  select (p_from::text, p_to::text) in (
    ('Submitted', 'Under Review'),
    ('Under Review', 'Declined'),
    ('Under Review', 'Awaiting Assets'),
    ('Under Review', 'Accepted'),
    ('Awaiting Assets', 'Under Review'),
    ('Awaiting Assets', 'Accepted'),
    ('Awaiting Assets', 'Withdrawn'),
    ('Accepted', 'Awaiting Assets'),
    ('Accepted', 'Invoice Issued'),
    ('Accepted', 'Withdrawn'),
    ('Invoice Issued', 'Invoice Issued'),
    ('Invoice Issued', 'Scheduled'),
    ('Invoice Issued', 'Withdrawn'),
    ('Scheduled', 'Published'),
    ('Published', 'Distribution Active'),
    ('Published', 'Completed'),
    ('Distribution Active', 'Completed')
  );
$$;
