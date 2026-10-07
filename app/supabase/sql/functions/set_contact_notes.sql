create or replace function public.set_contact_notes(
  p_contact_id uuid,
  p_notes text,
  p_expected_updated_at timestamptz,
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_request_id text
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.contacts;
  v_updated_at timestamptz;
begin
  -- Screen 27 (invariant 23): the internal notes on a person, saved whole. An editor who started from an older
  -- version gets `stale`, as on stories. `write_audit` stores `{"pii": "changed"}` for `notes` (B2's pii_columns).
  if p_notes is null or char_length(p_notes) > 5000 then
    raise exception 'validation';
  end if;
  select * into v_old from public.contacts c where c.id = p_contact_id for update;
  if not found then
    raise exception 'not_found';
  end if;
  if v_old.updated_at is distinct from p_expected_updated_at then
    raise exception 'stale';
  end if;
  update public.contacts
  set notes = p_notes
  where id = p_contact_id
  returning updated_at into v_updated_at;
  perform public.write_audit(
    p_actor, p_actor_kind, 'people.note', 'contact', p_contact_id,
    jsonb_build_object('id', p_contact_id, 'notes', v_old.notes),
    jsonb_build_object('id', p_contact_id, 'notes', p_notes),
    p_request_id
  );
  return v_updated_at;
end;
$$;

revoke execute on function public.set_contact_notes(uuid, text, timestamptz, uuid, public.actor_kind, text)
  from public, anon, authenticated;
grant execute on function public.set_contact_notes(uuid, text, timestamptz, uuid, public.actor_kind, text)
  to service_role;
