create or replace function public.newsletter_recipient_count(p_audience text)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  -- Invariant 5: the size of a broadcast before it is sent, for the quota gate and screen 13.
  select count(*)::int from public.newsletter_audience_members(p_audience);
$$;

revoke execute on function public.newsletter_recipient_count(text) from public, anon, authenticated;
grant execute on function public.newsletter_recipient_count(text) to service_role;
