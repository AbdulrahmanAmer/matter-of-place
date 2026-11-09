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
  )
  -- H151: only a person's token is staff: an account with no agent row and no key, as sessionPrincipal decides.
  and not exists (select 1 from public.user_roles a where a.user_id = auth.uid() and a.actor_kind = 'agent')
  and not exists (select 1 from public.agent_keys k where k.user_id = auth.uid());
$$;
