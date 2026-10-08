create or replace function public.automation_put_channel(
  p_channel text,
  p_patch jsonb,
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_request_id text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.channel_settings;
  v_new public.channel_settings;
begin
  select * into v_old from public.channel_settings where channel = p_channel for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if exists (
    select 1 from jsonb_object_keys(p_patch) k
    where k <> all (array['enabled', 'posting_window', 'approval_mode', 'auto_after', 'credentials_ref'])
  ) then
    raise exception 'invalid_patch_key' using errcode = '22023';
  end if;
  v_new := jsonb_populate_record(v_old, p_patch);
  -- Invariant 7: the revision trigger reads the actor of this transaction.
  perform set_config('mop.actor_id', coalesce(p_actor::text, ''), true);
  perform set_config('mop.actor_kind', coalesce(p_actor_kind::text, ''), true);
  perform set_config('mop.note', coalesce(p_note, ''), true);
  update public.channel_settings
  set enabled = v_new.enabled, posting_window = v_new.posting_window, approval_mode = v_new.approval_mode,
    auto_after = v_new.auto_after, credentials_ref = v_new.credentials_ref
  where id = v_old.id
  returning * into v_new;
  perform public.write_audit(
    p_actor, p_actor_kind, 'automation.channels_put', 'channel_settings', v_old.id, to_jsonb(v_old),
    to_jsonb(v_new), p_request_id, p_note
  );
  return to_jsonb(v_new);
end;
$$;

revoke execute on function public.automation_put_channel(text, jsonb, uuid, public.actor_kind, text, text)
  from public, anon, authenticated;
grant execute on function public.automation_put_channel(text, jsonb, uuid, public.actor_kind, text, text)
  to service_role;
