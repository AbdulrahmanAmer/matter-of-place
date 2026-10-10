create or replace function public.list_inquiries(
  p_limit integer,
  p_state public.inquiry_state default null,
  p_after_received_at timestamptz default null,
  p_after_id uuid default null
)
returns setof public.inquiries
language sql
stable
set search_path = ''
as $$
  -- Screen 11 (invariant 17c): one keyset page, newest first, ordered as the list index `inquiries_list_idx` is.
  select i.*
  from public.inquiries i
  where (p_state is null or i.state = p_state)
    and (
      p_after_received_at is null
      or i.received_at < p_after_received_at
      or (i.received_at = p_after_received_at and i.id > p_after_id)
    )
  order by i.received_at desc, i.id
  limit p_limit;
$$;

revoke execute on function public.list_inquiries(integer, public.inquiry_state, timestamptz, uuid)
  from public, anon, authenticated;
grant execute on function public.list_inquiries(integer, public.inquiry_state, timestamptz, uuid) to service_role;
