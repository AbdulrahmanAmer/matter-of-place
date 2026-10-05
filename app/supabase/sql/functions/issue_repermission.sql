create or replace function public.issue_repermission(p_subscriber_id uuid, p_token_hash text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  -- GG-05: the ask stores a fresh confirm hash; false means the subscriber no longer consents and nothing is sent.
  with changed as (
    update public.subscribers
    set confirm_token_hash = p_token_hash, repermission_sent_at = now()
    where id = p_subscriber_id and confirmed_at is not null and unsubscribed_at is null and archived_at is null
    returning 1
  )
  select exists (select 1 from changed);
$$;

revoke execute on function public.issue_repermission(uuid, text) from public, anon, authenticated;
grant execute on function public.issue_repermission(uuid, text) to service_role;
