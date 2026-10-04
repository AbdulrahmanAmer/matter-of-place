-- down: re-run bun run db:fn settings_put_site from the previous commit of supabase/sql/functions/settings_put_site.sql
set lock_timeout = '5s';

create or replace function public.settings_put_site(
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
  select s.value into v_before from public.settings s where s.key = 'site' for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  -- The version bump is B2's trigger on settings, in this same transaction (`site` is a public key).
  update public.settings set value = p_value where key = 'site';

  insert into public.audit_log (actor_id, actor_kind, action, entity, entity_id, before, after, request_id, note)
  values (p_actor, p_actor_kind, 'settings.site_put', 'settings.site', null, v_before, p_value, p_request_id, p_note);
end;
$$;

revoke execute on function public.settings_put_site(jsonb, uuid, public.actor_kind, text, text)
  from public, anon, authenticated;
grant execute on function public.settings_put_site(jsonb, uuid, public.actor_kind, text, text) to service_role;
