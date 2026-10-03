create or replace function public.unsubscribe_email(p_email text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  -- Clearing the hash makes a confirm link sent before this answer `confirmed=0` (DL-06 (c)).
  with changed as (
    update public.subscribers
    set unsubscribed_at = now(), confirm_token_hash = null, pending_source = null
    where lower(email) = lower(p_email) and unsubscribed_at is null
    returning 1
  )
  select exists (select 1 from changed);
$$;

revoke execute on function public.unsubscribe_email(text) from public, anon, authenticated;
grant execute on function public.unsubscribe_email(text) to service_role;
