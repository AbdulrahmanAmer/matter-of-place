create or replace function public.automation_recipes_trigger_locked()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.trigger <> old.trigger then
    raise exception 'trigger_locked';
  end if;
  return new;
end;
$$;

revoke execute on function public.automation_recipes_trigger_locked() from public, anon, authenticated;
