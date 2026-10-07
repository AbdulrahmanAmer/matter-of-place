create or replace function public.people_list(
  p_search text default null,
  p_kind public.submitter_kind default null,
  p_limit integer default 50,
  p_cursor_name text default null,
  p_cursor_id uuid default null
)
returns table (
  id uuid,
  name text,
  kind public.submitter_kind,
  brokerage text,
  email text,
  requests integer,
  accepted integer,
  published integer,
  last_activity_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  -- Screen 26 (invariant 23, S55): one keyset page of the people not anonymised, ordered as B2's
  -- `contacts_name_idx` is. The search text is compared with `position`, so no pattern is built from it (R44).
  select
    c.id,
    c.name,
    c.kind,
    c.brokerage,
    c.email,
    coalesce(s.requests, 0),
    coalesce(s.accepted, 0),
    coalesce(s.published, 0),
    greatest(c.updated_at, s.last_updated_at)
  from public.contacts c
  left join lateral (
    select
      count(*)::integer as requests,
      count(*) filter (where x.accepted_at is not null)::integer as accepted,
      count(p.id) filter (where p.first_published_at is not null)::integer as published,
      max(x.updated_at) as last_updated_at
    from public.submissions x
    left join public.properties p on p.submission_id = x.id
    where x.contact_id = c.id
  ) s on true
  where c.archived_at is null
    and (p_kind is null or c.kind = p_kind)
    and (
      p_search is null
      or position(lower(p_search) in lower(c.name)) > 0
      or position(lower(p_search) in lower(c.email)) > 0
      or position(lower(p_search) in lower(coalesce(c.brokerage, ''))) > 0
    )
    and (p_cursor_id is null or (lower(c.name), c.id) > (lower(p_cursor_name), p_cursor_id))
  order by lower(c.name), c.id
  limit least(greatest(coalesce(p_limit, 50), 1), 50);
$$;

revoke execute on function public.people_list(text, public.submitter_kind, integer, text, uuid)
  from public, anon, authenticated;
grant execute on function public.people_list(text, public.submitter_kind, integer, text, uuid) to service_role;
