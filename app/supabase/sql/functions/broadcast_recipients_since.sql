create or replace function public.broadcast_recipients_since(p_since timestamptz)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  -- Invariant 5: the recipients of the Place Notes issues and standalone emails sent since p_since. A dry run's
  -- broadcast id starts with `dry_` and never counts toward the cap (invariant 6).
  select (
    coalesce((
      select sum((i.metrics ->> 'recipients')::int)
      from public.newsletter_issues i
      where i.sent_at >= p_since and not coalesce(starts_with(i.resend_broadcast_id, 'dry_'), false)
    ), 0)
    + coalesce((
      select sum((a.meta -> 'broadcast' ->> 'recipients')::int)
      from public.assets a
      where a.kind = 'standalone_email'
        and (a.meta -> 'broadcast' ->> 'sent_at')::timestamptz >= p_since
        and not coalesce(starts_with(a.meta -> 'broadcast' ->> 'id', 'dry_'), false)
    ), 0)
  )::int;
$$;

revoke execute on function public.broadcast_recipients_since(timestamptz) from public, anon, authenticated;
grant execute on function public.broadcast_recipients_since(timestamptz) to service_role;
