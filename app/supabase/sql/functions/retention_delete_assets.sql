create or replace function public.retention_delete_assets(p_ids uuid[])
returns table (asset_id uuid, media_keys text[])
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_keep interval;
begin
  -- W8 item 1, GD-03: the rule of retention_requested_visuals is checked again here, with the policy row's own period,
  -- so no other asset can be named: a disabled policy deletes nothing. The rows go first and answer the keys of their
  -- files under `requested/`; retention.ts then removes those files (fresh Opus review, 2026-10-19: an orphan file does
  -- less harm than a row whose files are gone).
  select keep_for into v_keep
  from public.retention_policies
  where key = 'rejected_requested_visuals' and enabled and keep_for is not null;
  if not found then
    return;
  end if;
  perform set_config('mop.retention', 'on', true);
  return query
  with gone as (
    delete from public.assets a
    where a.id = any(p_ids)
      and a.subject <> 'property'
      and a.status = 'rejected'
      and a.meta ? 'request_id'
      and a.updated_at < now() - v_keep
      and not exists (select 1 from public.social_posts s where s.asset_id = a.id)
      and not exists (select 1 from public.proposed_post_channels c where c.asset_id = a.id)
    returning a.id, a.files
  )
  select g.id,
    coalesce(
      (
        select array_agg(f.file ->> 'media_key')
        from jsonb_array_elements(g.files) as f (file)
        where f.file ->> 'media_key' like 'requested/%'
      ),
      '{}'
    )
  from gone g
  order by g.id;
  perform set_config('mop.retention', 'off', true);
end;
$$;

revoke execute on function public.retention_delete_assets(uuid[]) from public, anon, authenticated;
grant execute on function public.retention_delete_assets(uuid[]) to service_role;
