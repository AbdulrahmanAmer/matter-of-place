create or replace function public.settings_put_invoice(
  p_value jsonb,
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_request_id text,
  p_note text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb;
begin
  -- G21: `invoice` is not a public key, so B2's trigger leaves catalog_version alone.
  select s.value into v_before from public.settings s where s.key = 'invoice' for update;
  insert into public.settings (key, value, updated_by)
  values ('invoice', p_value, p_actor)
  on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by;

  perform public.write_audit(
    p_actor, p_actor_kind, 'settings.invoice_put', 'settings.invoice', null, v_before, p_value, p_request_id, p_note
  );
end;
$$;

revoke execute on function public.settings_put_invoice(jsonb, uuid, public.actor_kind, text, text)
  from public, anon, authenticated;
grant execute on function public.settings_put_invoice(jsonb, uuid, public.actor_kind, text, text) to service_role;
