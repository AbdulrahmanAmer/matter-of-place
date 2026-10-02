-- down:
--   drop table public.pii_columns, public.audit_log, public.agent_keys, public.user_roles;
--   drop function public.audit_log_immutable();
set lock_timeout = '5s';

-- One person can hold several roles: the CEO is `admin` and `chief_editor` (ASSUMED A1).
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.app_role not null,
  actor_kind public.actor_kind not null default 'human',
  display_name text,
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, role)
);
create trigger user_roles_set_updated_at
before update on public.user_roles
for each row execute function public.set_updated_at();

-- API keys of agent accounts (S38), hashed at rest.
create table public.agent_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  key_hash text not null unique,
  label text not null,
  scopes text[] not null default '{}',
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index agent_keys_user_id_idx on public.agent_keys (user_id);

-- Append-only and kept forever (invariant 3), so personal data never enters it (invariant 18, DB-03). A row about
-- something without a uuid names it in `entity` (`settings.flags`, `retention`) with a null `entity_id`. No foreign
-- key on `actor_id`: a cascade would have to change a row that can never change.
create table public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_id uuid,
  actor_kind public.actor_kind,
  action text not null,
  entity text not null,
  entity_id uuid,
  before jsonb,
  after jsonb,
  request_id text,
  note text
);
create index audit_log_entity_idx on public.audit_log (entity, entity_id, at);
create index audit_log_actor_idx on public.audit_log (actor_id, at);

create or replace function public.audit_log_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'append_only';
end;
$$;

-- Binds the service role too, which RLS does not.
create trigger audit_log_immutable
before update or delete on public.audit_log
for each row execute function public.audit_log_immutable();

-- Every column that holds personal data (invariant 18, DB-03); the migration that creates such a column seeds its row.
create table public.pii_columns (
  table_name text,
  column_name text,
  primary key (table_name, column_name)
);

alter table public.user_roles enable row level security;
alter table public.agent_keys enable row level security;
alter table public.audit_log enable row level security;
alter table public.pii_columns enable row level security;
-- db:reset drops the schema's default privileges and a fresh stack still has them, so every grant is explicit
-- (invariant 1). The `authenticated` grants of the RLS matrix come with migration 10.
revoke all on table public.user_roles, public.agent_keys, public.audit_log, public.pii_columns
from anon, authenticated;
grant all on table public.user_roles, public.agent_keys, public.audit_log, public.pii_columns to service_role;
