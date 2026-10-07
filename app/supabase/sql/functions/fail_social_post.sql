create or replace function public.fail_social_post(p_id uuid, p_error text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- INT-01: only a scheduled row fails, so a run that lost a race never fails a row another run posted.
  update public.social_posts set status = 'failed', error = p_error where id = p_id and status = 'scheduled';
  return found;
end;
$$;

revoke execute on function public.fail_social_post(uuid, text) from public, anon, authenticated;
grant execute on function public.fail_social_post(uuid, text) to service_role;
