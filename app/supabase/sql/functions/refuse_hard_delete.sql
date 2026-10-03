create or replace function public.refuse_hard_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- GD-04: only B8's retention job (and test helpers) sets mop.retention, for its own transaction.
  if current_setting('mop.retention', true) = 'on' then
    return old;
  end if;
  raise exception 'hard_delete_refused';
end;
$$;
