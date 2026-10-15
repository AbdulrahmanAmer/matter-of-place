-- down: alter table public.agents drop constraint agents_slug_not_account_id;
set lock_timeout = '5s';

-- W8 0e (third review, ruling H113): a colleague's handle shaped like an account id could pass for an operator key's
-- line in a thread. Hiring refuses one already (`hireInputSchema`); the table now refuses it for every writer
-- (`workforce_hire`, `workforce_decide` and the runner's service role). No row matched on mop-dev when this was written
-- (2026-10-16: `select count(*) from public.agents where slug ~ <this pattern>` gave 0).
alter table public.agents
  add constraint agents_slug_not_account_id
  check (slug !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
