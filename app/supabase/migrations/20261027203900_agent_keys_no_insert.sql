-- down:
--   grant insert on public.agent_keys to authenticated;
--   create policy agent_keys_insert_admin on public.agent_keys for insert to authenticated
--   with check (app.role_in('admin'));
-- H151 review: no code inserts a key as a signed-in user; every key is made by `create_agent_key` under the service
-- role, which refuses the `team` and `settings` scopes. The direct insert a person's token could make skipped that
-- check, so it goes, with its grant (the RLS matrix grants a table privilege only where a policy uses it).
set lock_timeout = '5s';

drop policy agent_keys_insert_admin on public.agent_keys;
revoke insert on public.agent_keys from authenticated;
