create or replace function public.email_sent_today()
returns int
language sql
stable
security definer
set search_path = ''
as $$
  -- Invariant 5: every row Resend accepted in the current UTC day, whatever happened to it since, plus the recipients
  -- of the broadcasts sent that day (B11), so the daily cap sees a Place Notes issue.
  select (
    select count(*)::int
    from public.email_messages
    where sent_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'
  ) + public.broadcast_recipients_since(date_trunc('day', now() at time zone 'utc') at time zone 'utc');
$$;

revoke execute on function public.email_sent_today() from public, anon, authenticated;
grant execute on function public.email_sent_today() to service_role;
