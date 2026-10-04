-- down:
--   delete from public.settings where key = 'flags';
--   drop view public.market_interest_counts;
--   drop trigger refuse_illustrative_in_production on public.properties;
--   drop function public.refuse_illustrative_in_production(), public.set_environment(text);
set lock_timeout = '5s';

-- B3b step 3 (S30, ruling H35): production holds no Illustrative property. The function texts are
-- supabase/sql/functions/set_environment.sql and refuse_illustrative_in_production.sql (R19).

create or replace function public.set_environment(p_value text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb;
begin
  if p_value is null or p_value not in ('development', 'preview', 'production') then
    raise exception 'invalid_environment';
  end if;

  -- The row is held before the check, so an illustrative insert either commits first and is seen here, or waits in
  -- refuse_illustrative_in_production and then reads production.
  select s.value into v_before from public.settings s where s.key = 'environment' for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if p_value = 'production' and exists (select 1 from public.properties p where p.status = 'Illustrative') then
    raise exception 'illustrative_in_production';
  end if;

  -- The version bump is B2's trigger on settings, in this same transaction (`environment` is a public key).
  update public.settings set value = to_jsonb(p_value) where key = 'environment';

  -- A system write (G43): no actor, no actor kind.
  insert into public.audit_log (actor_id, actor_kind, action, entity, entity_id, before, after, note)
  values (null, null, 'settings.environment_set', 'settings.environment', null, v_before, to_jsonb(p_value), 'system');
end;
$$;

revoke execute on function public.set_environment(text) from public, anon, authenticated;
grant execute on function public.set_environment(text) to service_role;

create or replace function public.refuse_illustrative_in_production()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_environment text;
begin
  if new.status <> 'Illustrative' then
    return new;
  end if;

  -- `for share` waits on a set_environment that holds the row, then reads the value it committed.
  select s.value #>> '{}' into v_environment from public.settings s where s.key = 'environment' for share;
  if v_environment = 'production' then
    raise exception 'illustrative_in_production';
  end if;
  return new;
end;
$$;

revoke execute on function public.refuse_illustrative_in_production() from public, anon, authenticated;
grant execute on function public.refuse_illustrative_in_production() to service_role;

-- Invariant 1: a trigger fires whatever the caller's execute rights.
create trigger refuse_illustrative_in_production
before insert or update on public.properties
for each row execute function public.refuse_illustrative_in_production();

-- The interest signups per market (B7 reads it). It runs with the caller's rights, so B2's `subscribers` policy
-- limits it to staff (G-100: the grants are stated, never left to defaults).
create view public.market_interest_counts
with (security_invoker = true) as
select
  m.market_slug,
  count(*) as total,
  count(*) filter (where s.confirmed_at is not null) as confirmed,
  count(*) filter (where s.confirmed_at is null) as pending
from public.subscribers s
cross join lateral unnest(s.markets) as m (market_slug)
where s.unsubscribed_at is null and s.archived_at is null
group by m.market_slug;

revoke all on public.market_interest_counts from public, anon, authenticated;
grant select on public.market_interest_counts to authenticated, service_role;

-- GQ-05: a structural row, so it runs in production too; B2's settings trigger bumps catalog_version for this key.
insert into public.settings (key, value)
values ('flags', '{"new_channels": false, "archive_pages": false}'::jsonb)
on conflict (key) do nothing;
