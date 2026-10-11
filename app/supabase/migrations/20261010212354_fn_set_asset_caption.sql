-- down: re-run bun run db:fn set_asset_caption from the previous commit of supabase/sql/functions/set_asset_caption.sql
set lock_timeout = '5s';

create or replace function public.set_asset_caption(
  p_asset uuid,
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_captions jsonb default null,
  p_alt_text text default null,
  p_request_id text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asset public.assets;
  v_job record;
begin
  select * into v_asset from public.assets a where a.id = p_asset for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  -- Security scan F3: the social publisher reads the caption of the live row and treats a human approval of the
  -- asset as still valid, so a caption or alt text may change only while the asset waits for that approval.
  if v_asset.status <> 'pending' then
    raise exception 'wrong_state' using errcode = '55000';
  end if;

  -- The caption column mirrors captions.instagram. The service has already linted every edited variant, and
  -- caption_lint = 'edited' tells write_captions never to overwrite what an editor typed (H34 (5)).
  update public.assets
  set caption = coalesce(p_captions ->> 'instagram', caption),
    alt_text = coalesce(p_alt_text, alt_text),
    meta = meta
      || jsonb_build_object('caption_lint', 'edited')
      || case
        when p_captions is null then '{}'::jsonb
        else jsonb_build_object('captions', coalesce(meta -> 'captions', '{}'::jsonb) || p_captions)
      end
  where id = p_asset;

  -- H34 (5): nothing downstream waits on the laptop. A queued write_captions job of this property is done; a running
  -- one is the runner's and stays running.
  for v_job in
    select j.id, j.attempts, j.heavy, j.msg_id
    from public.jobs j
    where j.type = 'write_captions'
      and j.status = 'queued'
      and j.payload -> 'data' ->> 'property_id' = v_asset.property_id::text
    for update
  loop
    if v_job.msg_id is not null then
      perform public.job_queue_delete(v_job.heavy, v_job.msg_id);
    end if;
    update public.jobs
    set status = 'done', result = '{"manual": true}'::jsonb, finished_at = now(), msg_id = null
    where id = v_job.id;
    insert into public.job_events (job_id, kind, from_status, to_status, attempt, actor_id)
    values (v_job.id, 'done', 'queued', 'done', v_job.attempts, p_actor);
  end loop;

  insert into public.audit_log (actor_id, actor_kind, action, entity, entity_id, request_id)
  values (p_actor, p_actor_kind, 'assets.caption', 'assets', p_asset, p_request_id);
end;
$$;

revoke execute on function public.set_asset_caption(uuid, uuid, public.actor_kind, jsonb, text, text)
  from public, anon, authenticated;
grant execute on function public.set_asset_caption(uuid, uuid, public.actor_kind, jsonb, text, text)
  to service_role;
