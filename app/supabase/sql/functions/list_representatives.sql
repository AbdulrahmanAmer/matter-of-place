create or replace function public.list_representatives(
  p_limit integer,
  p_search text default null,
  p_after_name text default null,
  p_after_id uuid default null
)
returns table (
  id uuid,
  name text,
  brokerage text,
  license text,
  email text,
  phone text
)
language sql
stable
security definer
set search_path = ''
as $$
  -- The Representation tab's search (B7 invariant 17c): one keyset page in name order on representatives_name_idx.
  -- The search is a parameter matched as plain text, never part of the query text (R44).
  select r.id, r.name, r.brokerage, r.license, r.email, r.phone
  from public.representatives r
  where (
      p_search is null
      or strpos(lower(r.name), lower(p_search)) > 0
      or strpos(lower(r.brokerage), lower(p_search)) > 0
    )
    and (p_after_name is null or (lower(r.name), r.id) > (lower(p_after_name), p_after_id))
  order by lower(r.name), r.id
  limit least(greatest(p_limit, 1), 51);
$$;

revoke execute on function public.list_representatives(integer, text, text, uuid) from public, anon, authenticated;
grant execute on function public.list_representatives(integer, text, text, uuid) to service_role;
