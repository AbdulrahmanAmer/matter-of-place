create or replace function public.client_credits_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- W6 item 8 (ruling H142): the ledger is never edited, deleted or emptied, by any role. The one delete allowed is a
  -- cleanup of test fixtures that asks for it (`mop.fixture_cleanup`), and never on the production database (ruling H35):
  -- only a known non-production environment allows it, as `public_state` reads it, so a missing row refuses.
  if tg_op = 'DELETE' and current_setting('mop.fixture_cleanup', true) = 'on'
    and (select s.value #>> '{}' in ('development', 'preview') from public.settings s where s.key = 'environment') then
    return old;
  end if;
  raise exception 'append_only';
end;
$$;

revoke execute on function public.client_credits_immutable() from public, anon, authenticated;
