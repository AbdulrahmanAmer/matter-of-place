-- down: alter table public.agents drop constraint agents_slug_not_account_id;
set lock_timeout = '5s';

-- W8 0e (ruling H113): a colleague's handle shaped like an account id could pass for an operator key's line in a
-- thread, so the table refuses one for every writer (`workforce_hire`, an approved hire in `workforce_decide`, and the
-- runner's service role). Checked on mop-dev when this was written (2026-10-16): no row of `public.agents` matched, and
-- no hire proposal existed in `public.agent_approvals`, pending or decided.
alter table public.agents
  add constraint agents_slug_not_account_id
  check (slug !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
