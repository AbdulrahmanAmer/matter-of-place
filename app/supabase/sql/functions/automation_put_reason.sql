create or replace function public.automation_put_reason(
  p_id uuid,
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
  v_old public.decline_reasons;
  v_new public.decline_reasons;
begin
  if exists (
    select 1 from jsonb_object_keys(p_patch) k
    where k <> all (array['code', 'label', 'email_paragraph', 'sort', 'enabled'])
  ) then
    raise exception 'invalid_patch_key' using errcode = '22023';
  end if;
  if p_id is not null then
    select * into v_old from public.decline_reasons where id = p_id for update;
    if not found then
      raise exception 'not_found' using errcode = 'P0002';
    end if;
  end if;
  -- Invariant 7: the revision trigger reads the actor of this transaction.
  perform set_config('mop.actor_id', coalesce(p_actor::text, ''), true);
  perform set_config('mop.actor_kind', coalesce(p_actor_kind::text, ''), true);
  perform set_config('mop.note', coalesce(p_note, ''), true);
  if p_id is null then
    v_new := jsonb_populate_record(null::public.decline_reasons, p_patch);
    -- A new reason goes last in the list of screen 19.
    insert into public.decline_reasons (code, label, email_paragraph, sort, enabled)
    values (
      v_new.code, v_new.label, v_new.email_paragraph,
      coalesce(v_new.sort, (select coalesce(max(r.sort), 0) + 1 from public.decline_reasons r)),
      coalesce(v_new.enabled, true)
    )
    returning * into v_new;
  else
    v_new := jsonb_populate_record(v_old, p_patch);
    update public.decline_reasons
    set code = v_new.code, label = v_new.label, email_paragraph = v_new.email_paragraph, sort = v_new.sort,
      enabled = v_new.enabled
    where id = p_id
    returning * into v_new;
  end if;
  -- STUB(B8b step 6): unconditional write_audit
  if to_regproc('public.write_audit') is not null then
    perform public.write_audit(
      p_actor, p_actor_kind, 'automation.reasons_put', 'decline_reasons', v_new.id,
      case when p_id is null then null else to_jsonb(v_old) end, to_jsonb(v_new), p_request_id, p_note
    );
  end if;
  return to_jsonb(v_new);
end;
$$;

revoke execute on function public.automation_put_reason(uuid, jsonb, uuid, public.actor_kind, text, text)
  from public, anon, authenticated;
grant execute on function public.automation_put_reason(uuid, jsonb, uuid, public.actor_kind, text, text)
  to service_role;
