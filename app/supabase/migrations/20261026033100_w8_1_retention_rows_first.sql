-- down: re-run bun run db:fn retention_requested_visuals retention_delete_assets from the previous commit of supabase/sql/functions/retention_requested_visuals.sql, supabase/sql/functions/retention_delete_assets.sql
set lock_timeout = '5s';

create or replace function public.retention_requested_visuals(p_keep interval)
returns table (asset_id uuid, media_keys text[])
language sql
stable
security definer
set search_path = ''
as $$
  -- W8 item 1, GD-03: a visual made on request (a reel or a still post about a market, a story or the brand, H107) that
  -- a person rejected and nobody touched for p_keep, with the keys of its files under `requested/` in bucket `media`.
  -- A property's asset goes with its property, and an asset any post points at stays with that post. It lists only;
  -- retention.ts deletes the rows through retention_delete_assets, then removes the files of the rows it deleted.
  select a.id,
    coalesce(
      array_agg(f.file ->> 'media_key') filter (where f.file ->> 'media_key' like 'requested/%'),
      '{}'
    )
  from public.assets a
  left join lateral jsonb_array_elements(a.files) as f (file) on true
  where a.subject <> 'property'
    and a.status = 'rejected'
    and a.meta ? 'request_id'
    and a.updated_at < now() - p_keep
    and not exists (select 1 from public.social_posts s where s.asset_id = a.id)
    and not exists (select 1 from public.proposed_post_channels c where c.asset_id = a.id)
  group by a.id
  order by a.id;
$$;

revoke execute on function public.retention_requested_visuals(interval) from public, anon, authenticated;
grant execute on function public.retention_requested_visuals(interval) to service_role;

-- the return type changes (an int becomes the deleted rows and their keys), which create or replace refuses
drop function if exists public.retention_delete_assets(uuid[]);

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
