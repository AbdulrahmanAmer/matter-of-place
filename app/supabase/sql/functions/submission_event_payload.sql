create or replace function public.submission_event_payload(p_submission public.submissions)
returns jsonb
language sql
stable
set search_path = ''
as $$
  -- The keys every decision event carries (B7 Contract, events emitted): the request, the tier its package buys and
  -- its market slug. ASSUMED: a package of "Not sure yet" buys no tier and reads as Editorial, which no recipe
  -- condition can name.
  select jsonb_build_object(
    'submission_id', p_submission.id,
    'tier', coalesce(public.payment_tier(p_submission.package), 'Editorial'),
    'market', lower(replace(p_submission.state::text, ' ', '-'))
  )
$$;

revoke execute on function public.submission_event_payload(public.submissions) from public, anon, authenticated;
grant execute on function public.submission_event_payload(public.submissions) to service_role;
