create or replace function public.refuse_illustrative_in_production()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_environment text;
begin
  if new.status <> 'Illustrative' then
    return new;
  end if;

  -- `for share` waits on a set_environment that holds the row, then reads the value it committed.
  select s.value #>> '{}' into v_environment from public.settings s where s.key = 'environment' for share;
  if v_environment = 'production' then
    raise exception 'illustrative_in_production';
  end if;
  return new;
end;
$$;

revoke execute on function public.refuse_illustrative_in_production() from public, anon, authenticated;
grant execute on function public.refuse_illustrative_in_production() to service_role;
