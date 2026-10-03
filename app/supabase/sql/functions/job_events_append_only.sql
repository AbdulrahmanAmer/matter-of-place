create or replace function public.job_events_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Only prune_jobs and the retention job delete, inside their own transaction (G16).
  if tg_op = 'DELETE' and current_setting('mop.retention', true) = 'on' then
    return old;
  end if;
  raise exception 'append_only';
end;
$$;

revoke execute on function public.job_events_append_only() from public, anon, authenticated;
