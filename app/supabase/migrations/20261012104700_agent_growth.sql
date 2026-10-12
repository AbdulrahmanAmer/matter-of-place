-- down:
--   drop table if exists public.agent_instruction_versions;
--   drop table if exists public.agent_lessons;
--   alter table public.agent_runs drop column if exists input_tokens, drop column if exists output_tokens,
--     drop column if exists cost_microusd, drop column if exists lessons_used;
--   alter table public.agent_approvals drop column if exists reason, drop column if exists edited_content;
set lock_timeout = '5s';

-- W2 step 6 (contract 7, "How the staff learns"): every employee grows from real outcomes. The approval decision is the
-- training signal: a decline keeps its reason, an edit keeps what the operator approved instead, and either becomes a
-- lesson for that employee. Instructions are versioned; a lesson used often is promoted into them on the operator's yes.

alter table public.agent_approvals
  add column reason text check (reason is null or char_length(reason) between 1 and 1000),
  add column edited_content jsonb;

-- What a run cost, from the CLI's own token counts and our price table (never the CLI's reported cost), and which
-- lessons it was shown, which ranks them.
alter table public.agent_runs
  add column input_tokens integer not null default 0 check (input_tokens >= 0),
  add column output_tokens integer not null default 0 check (output_tokens >= 0),
  add column cost_microusd bigint not null default 0 check (cost_microusd >= 0),
  add column lessons_used uuid[] not null default '{}';

create table public.agent_lessons (
  id uuid primary key default gen_random_uuid(),
  -- null: a lesson for the whole team.
  agent_id uuid references public.agents (id) on delete cascade,
  trigger text not null check (char_length(trigger) between 3 and 300),
  action text not null check (char_length(action) between 3 and 1000),
  evidence_ref text not null check (char_length(evidence_ref) between 1 and 200),
  source text not null check (source in ('decline', 'edit', 'outcome', 'matter')),
  status text not null default 'active' check (status in ('active', 'retired', 'promoted')),
  uses integer not null default 0 check (uses >= 0),
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);
create index agent_lessons_agent_status on public.agent_lessons (agent_id, status);

create table public.agent_instruction_versions (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents (id) on delete cascade,
  version integer not null check (version >= 1),
  instructions text not null check (char_length(instructions) <= 8000),
  reason text not null check (char_length(reason) between 1 and 1000),
  approval_id uuid references public.agent_approvals (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (agent_id, version)
);
create index agent_instruction_versions_approval on public.agent_instruction_versions (approval_id);

alter table public.agent_lessons enable row level security;
alter table public.agent_instruction_versions enable row level security;
-- G-100: every grant is explicit. Staff read; every write is workforce_decide or the laptop runner's service role.
revoke all on table public.agent_lessons, public.agent_instruction_versions from anon, authenticated;
grant all on table public.agent_lessons, public.agent_instruction_versions to service_role;
grant select on table public.agent_lessons, public.agent_instruction_versions to authenticated;
create policy agent_lessons_select_staff on public.agent_lessons for select to authenticated
  using (app.is_staff());
create policy agent_instruction_versions_select_staff on public.agent_instruction_versions for select
  to authenticated using (app.is_staff());
