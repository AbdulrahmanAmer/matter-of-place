create or replace function public.retention_delete_assets(p_ids uuid[])
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_keep interval;
  v_count int;
begin
  -- W8 item 1, GD-03: retention.ts passes only the ids whose files are already removed. The rule of
  -- retention_requested_visuals is checked again here, with the policy row's own period, so no other asset can be
  -- named: a disabled policy deletes nothing.
  select keep_for into v_keep
  from public.retention_policies
  where key = 'rejected_requested_visuals' and enabled and keep_for is not null;
  if not found then
    return 0;
  end if;
  perform set_config('mop.retention', 'on', true);
  with gone as (
    delete from public.assets a
    where a.id = any(p_ids)
      and a.subject <> 'property'
      and a.status = 'rejected'
      and a.meta ? 'request_id'
      and a.updated_at < now() - v_keep
      and not exists (select 1 from public.social_posts s where s.asset_id = a.id)
      and not exists (select 1 from public.proposed_post_channels c where c.asset_id = a.id)
    returning 1
  )
  select count(*)::int into v_count from gone;
  perform set_config('mop.retention', 'off', true);
  return v_count;
end;
$$;

revoke execute on function public.retention_delete_assets(uuid[]) from public, anon, authenticated;
grant execute on function public.retention_delete_assets(uuid[]) to service_role;
