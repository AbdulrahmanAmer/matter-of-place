-- down: drop table public.agent_activity;
set lock_timeout = '5s';

-- W5 items 7 and 8 (operator, 2026-10-13: "what command is he running, I want a similar interface of how am I able to
-- see your background tasks"): what an AI colleague is running, one row a background task, written by Matter's live
-- supervisor on the laptop (service role) and read by staff in the side chat.
create table public.agent_activity (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents (id) on delete cascade,
  task_key text not null check (char_length(task_key) between 1 and 200),
  label text not null check (char_length(label) between 1 and 300),
  state text not null default 'running' check (state in ('running', 'done', 'stopped')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (agent_id, task_key)
);
create index agent_activity_agent_started on public.agent_activity (agent_id, started_at desc);

alter table public.agent_activity enable row level security;
-- G-100: every grant is explicit. Staff read; the laptop runner writes under the service role.
revoke all on table public.agent_activity from anon, authenticated;
grant all on table public.agent_activity to service_role;
grant select on table public.agent_activity to authenticated;
create policy agent_activity_select_staff on public.agent_activity for select to authenticated
  using (app.is_staff());
