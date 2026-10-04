create or replace function public.retention_delete_media(p_ids uuid[])
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  -- GD-03: retention.ts passes only the ids whose Storage objects are already removed.
  perform set_config('mop.retention', 'on', true);
  with gone as (
    delete from public.submission_media where id = any(p_ids) returning 1
  )
  select count(*)::int into v_count from gone;
  perform set_config('mop.retention', 'off', true);
  return v_count;
end;
$$;

revoke execute on function public.retention_delete_media(uuid[]) from public, anon, authenticated;
grant execute on function public.retention_delete_media(uuid[]) to service_role;
