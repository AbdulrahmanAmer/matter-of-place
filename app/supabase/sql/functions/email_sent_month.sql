create or replace function public.email_sent_month()
returns int
language sql
stable
security definer
set search_path = ''
as $$
  -- Invariant 5: every row Resend accepted in the current UTC month, plus the recipients of the broadcasts sent that
  -- month (B11).
  select (
    select count(*)::int
    from public.email_messages
    where sent_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc'
  ) + public.broadcast_recipients_since(date_trunc('month', now() at time zone 'utc') at time zone 'utc');
$$;

revoke execute on function public.email_sent_month() from public, anon, authenticated;
grant execute on function public.email_sent_month() to service_role;
