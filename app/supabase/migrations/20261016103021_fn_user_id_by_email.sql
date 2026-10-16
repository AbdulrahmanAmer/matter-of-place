-- down: re-run bun run db:fn user_id_by_email from the previous commit of supabase/sql/functions/user_id_by_email.sql
set lock_timeout = '5s';

create or replace function public.user_id_by_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  -- W6 item 7 second review: the Team invite finds the auth user of an address that already exists. The Auth API has no
  -- read by address, and `generateLink` mints a live sign-in token (it can cancel a link waiting in that person's
  -- inbox), so the service role reads the one row here, ignoring case.
  select u.id
  from auth.users u
  where lower(u.email) = lower(p_email)
  limit 1;
$$;

revoke execute on function public.user_id_by_email(text) from public, anon, authenticated;
grant execute on function public.user_id_by_email(text) to service_role;
