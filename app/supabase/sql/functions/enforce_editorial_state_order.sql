create or replace function public.enforce_editorial_state_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.editorial_state <> old.editorial_state
    and not public.editorial_transition_allowed(old.editorial_state, new.editorial_state) then
    raise exception 'wrong_state';
  end if;
  return new;
end;
$$;
