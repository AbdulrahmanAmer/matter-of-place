create or replace function public.settings_email_share()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Invariant 5, ruling H35 (4): the stage and its share of the one Resend account change in one transaction, so the
  -- launch switch's set_environment('production') moves settings.email to the production share.
  update public.settings
  set value = case
    when new.value #>> '{}' = 'production'
      then '{"daily_cap": 75, "bulk_cap": 50, "monthly_cap": 2600, "dev_recipients": []}'::jsonb
    else '{"daily_cap": 15, "bulk_cap": 5, "monthly_cap": 300, "dev_recipients": ["admin@matterofplace.com", "admin+*@matterofplace.com", "*@resend.dev"]}'::jsonb
  end
  where key = 'email';
  return null;
end;
$$;

revoke execute on function public.settings_email_share() from public, anon, authenticated;

create or replace trigger settings_email_share
after update of value on public.settings
for each row when (new.key = 'environment')
execute function public.settings_email_share();
