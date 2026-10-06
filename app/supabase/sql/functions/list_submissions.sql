create or replace function public.list_submissions(
  p_limit integer,
  p_states public.submission_state[] default null,
  p_market public.accepted_state default null,
  p_package public.exposure_package default null,
  p_search text default null,
  p_without_property boolean default false,
  p_after_received_at timestamptz default null,
  p_after_id uuid default null
)
returns setof public.submission_list
language sql
stable
set search_path = ''
as $$
  -- Screen 3 (invariant 17c): one keyset page of `submission_list`, newest first, ordered as the list index
  -- `submissions_list_idx` is. The search text arrives as a parameter, never inside a filter string (R44).
  with q as (
    select '%' || replace(replace(replace(p_search, '\', '\\'), '%', '\%'), '_', '\_') || '%' as pattern
  )
  select l.*
  from public.submission_list l, q
  where (p_states is null or l.workflow_state = any (p_states))
    and (p_market is null or l.state = p_market)
    and (p_package is null or l.package = p_package)
    and (
      p_search is null
      or l.address ilike q.pattern
      or l.submitter_name ilike q.pattern
      or l.brokerage ilike q.pattern
    )
    -- The accepted requests still without the property made from them (screen 7, "New from request").
    and (
      not p_without_property
      or (
        l.accepted_at is not null
        and l.workflow_state in ('Accepted', 'Awaiting Assets', 'Invoice Issued', 'Scheduled')
        and l.property_id is null
      )
    )
    and (
      p_after_received_at is null
      or l.received_at < p_after_received_at
      or (l.received_at = p_after_received_at and l.id > p_after_id)
    )
  order by l.received_at desc, l.id
  limit p_limit;
$$;

revoke execute on function public.list_submissions(
  integer, public.submission_state[], public.accepted_state, public.exposure_package, text, boolean, timestamptz, uuid
) from public, anon, authenticated;
grant execute on function public.list_submissions(
  integer, public.submission_state[], public.accepted_state, public.exposure_package, text, boolean, timestamptz, uuid
) to service_role;
