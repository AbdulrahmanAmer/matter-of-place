-- down: re-create app.role_in and app.is_staff from the previous commit of supabase/sql/functions/role_in.sql and
--   is_staff.sql (the same text without the actor_kind and agent_keys lines).
-- H151: an agent account may now hold a sign-in token (Matter signs in to the admin from the laptop). Its token grants
-- nothing through row-level security: the policy helpers answer only for a person (a role row of kind human, on an
-- account that never held a key, as sessionPrincipal decides), so an agent acts only through the Worker, where the
-- matrix and the audit apply. db:fn writes public functions only, so this file holds the two function files as they are.
set lock_timeout = '5s';

create or replace function app.role_in(variadic p_roles public.app_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles r
    where r.user_id = auth.uid()
      and r.role = any (p_roles)
      and r.disabled_at is null
      and r.actor_kind = 'human'
      and not exists (select 1 from public.agent_keys k where k.user_id = r.user_id)
  );
$$;

create or replace function app.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles r
    where r.user_id = auth.uid()
      and r.disabled_at is null
      and r.actor_kind = 'human'
      and not exists (select 1 from public.agent_keys k where k.user_id = r.user_id)
  );
$$;
