create or replace function public.client_credits_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- W6 item 8 (ruling H142): the ledger is never edited, deleted or emptied, by any role. The one delete allowed is a
  -- cleanup of test fixtures that asks for it (`mop.fixture_cleanup`), and never on the production database (ruling H35).
  if tg_op = 'DELETE' and current_setting('mop.fixture_cleanup', true) = 'on'
    and (select s.value #>> '{}' from public.settings s where s.key = 'environment') is distinct from 'production' then
    return old;
  end if;
  raise exception 'append_only';
end;
$$;

revoke execute on function public.client_credits_immutable() from public, anon, authenticated;
