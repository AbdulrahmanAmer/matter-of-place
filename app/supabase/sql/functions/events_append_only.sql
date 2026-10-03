create or replace function public.events_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- G16: only the retention job deletes, inside its own transaction.
  if tg_op = 'DELETE' then
    if current_setting('mop.retention', true) = 'on' then
      return old;
    end if;
    raise exception 'append_only';
  end if;
  -- B8b's fan-out marks an event processed once; nothing else of an event ever changes.
  if old.processed_at is null and new.processed_at is not null
    and to_jsonb(new) - 'processed_at' = to_jsonb(old) - 'processed_at' then
    return new;
  end if;
  raise exception 'append_only';
end;
$$;

revoke execute on function public.events_append_only() from public, anon, authenticated;
