create or replace function public.subscribers_engagement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- GG-05: a confirm or a re-confirm is engagement, and it answers an open re-permission ask.
  new.last_engaged_at := now();
  new.repermission_sent_at := null;
  return new;
end;
$$;

revoke execute on function public.subscribers_engagement() from public, anon, authenticated;

create or replace trigger subscribers_engagement
before update of confirmed_at on public.subscribers
for each row when (new.confirmed_at is not null and new.confirmed_at is distinct from old.confirmed_at)
execute function public.subscribers_engagement();
