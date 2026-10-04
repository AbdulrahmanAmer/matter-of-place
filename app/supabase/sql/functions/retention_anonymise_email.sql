create or replace function public.retention_anonymise_email(p_dry_run boolean default false)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_keep interval;
  v_count int;
begin
  -- G16, G43: the recipient address of a sent email goes after the email_pii period. B5 creates the two tables and the
  -- row, so this answers 0 until both exist; execute lets the function compile before them.
  select keep_for into v_keep
  from public.retention_policies
  where key = 'email_pii' and enabled and keep_for is not null;
  if not found or to_regclass('public.email_messages') is null then
    return 0;
  end if;
  if p_dry_run then
    execute $q$
      select (select count(*) from public.email_messages where to_email is not null and created_at < now() - $1)
        + (select count(*) from public.email_events where to_email is not null and at < now() - $1)
    $q$ into v_count using v_keep;
    return v_count;
  end if;
  execute $q$
    with messages as (
      update public.email_messages set to_email = null
      where to_email is not null and created_at < now() - $1
      returning 1
    ),
    events as (
      update public.email_events set to_email = null
      where to_email is not null and at < now() - $1
      returning 1
    )
    select (select count(*) from messages) + (select count(*) from events)
  $q$ into v_count using v_keep;
  update public.retention_policies set last_run_at = now(), last_count = v_count where key = 'email_pii';
  return v_count;
end;
$$;

revoke execute on function public.retention_anonymise_email(boolean) from public, anon, authenticated;
grant execute on function public.retention_anonymise_email(boolean) to service_role;
