-- down:
--   drop function if exists public.claim_agent_run(text, integer);
--   drop table if exists public.agent_approvals;
--   drop table if exists public.agent_runs;
--   drop table if exists public.agent_messages;
--   drop table if exists public.agents;
set lock_timeout = '5s';

-- W1 (operator, 2026-10-12): AI employees that run Matter of Place from the operator's laptop. The admin API writes
-- these rows with the service role after `authorize`; the laptop daemon claims runs through `claim_agent_run`. Staff
-- read through RLS; nobody writes directly (W1 invariant 5).

create table public.agents (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z][a-z0-9-]{1,39}$'),
  name text not null check (char_length(name) between 1 and 80),
  role text not null check (char_length(role) between 1 and 120),
  instructions text not null default '' check (char_length(instructions) <= 8000),
  model text not null default 'sonnet' check (model in ('opus', 'sonnet', 'haiku')),
  wake_on text[] not null default '{}',
  tools text[] not null default '{}',
  state text not null default 'idle' check (state in ('idle', 'working', 'paused', 'off')),
  current_task text,
  last_seen_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.agent_messages (
  id uuid primary key default gen_random_uuid(),
  thread text not null check (thread = 'team' or thread ~ '^[a-z][a-z0-9-]{1,39}$'),
  author_kind text not null check (author_kind in ('human', 'agent', 'system')),
  author_id text not null,
  author_name text not null check (char_length(author_name) between 1 and 80),
  body text not null check (char_length(body) between 1 and 20000),
  created_at timestamptz not null default now()
);
create index agent_messages_thread_created on public.agent_messages (thread, created_at desc);

create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents (id) on delete cascade,
  cause text not null check (cause in ('event', 'message', 'schedule')),
  event_id uuid,
  message_id uuid references public.agent_messages (id) on delete set null,
  state text not null default 'queued' check (state in ('queued', 'running', 'done', 'failed')),
  worker text,
  lease_until timestamptz,
  session_id text,
  turns integer not null default 0,
  summary text,
  error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index agent_runs_state_created on public.agent_runs (state, created_at);
create index agent_runs_agent_created on public.agent_runs (agent_id, created_at desc);
-- One run per (agent, event): a re-read of the same event never wakes an employee twice.
create unique index agent_runs_agent_event on public.agent_runs (agent_id, event_id) where event_id is not null;

create table public.agent_approvals (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents (id) on delete cascade,
  run_id uuid references public.agent_runs (id) on delete set null,
  action text not null check (char_length(action) between 1 and 80),
  summary text not null check (char_length(summary) between 1 and 500),
  content jsonb not null,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  state text not null default 'pending' check (state in ('pending', 'approved', 'rejected', 'void')),
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index agent_approvals_state_created on public.agent_approvals (state, created_at desc);

alter table public.agents enable row level security;
alter table public.agent_messages enable row level security;
alter table public.agent_runs enable row level security;
alter table public.agent_approvals enable row level security;
-- G-100: every grant is explicit.
revoke all on table public.agents, public.agent_messages, public.agent_runs, public.agent_approvals
from anon, authenticated;
grant all on table public.agents, public.agent_messages, public.agent_runs, public.agent_approvals to service_role;
grant select on table public.agents, public.agent_messages, public.agent_runs, public.agent_approvals
to authenticated;
create policy agents_select_staff on public.agents for select to authenticated using (app.is_staff());
create policy agent_messages_select_staff on public.agent_messages for select to authenticated
using (app.is_staff());
create policy agent_runs_select_staff on public.agent_runs for select to authenticated using (app.is_staff());
create policy agent_approvals_select_staff on public.agent_approvals for select to authenticated
using (app.is_staff());

-- The laptop daemon's claim: the oldest queued run, or a running one whose lease ran out, taken once with a lease.
create or replace function public.claim_agent_run(p_worker text, p_lease_seconds integer default 900)
returns setof public.agent_runs
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  update public.agent_runs r
  set state = 'running',
      worker = p_worker,
      lease_until = now() + make_interval(secs => p_lease_seconds),
      started_at = coalesce(r.started_at, now())
  where r.id = (
    select c.id
    from public.agent_runs c
    join public.agents a on a.id = c.agent_id
    where a.state in ('idle', 'working')
      and (c.state = 'queued' or (c.state = 'running' and c.lease_until < now()))
    order by c.created_at
    limit 1
    for update of c skip locked
  )
  returning r.*;
end;
$$;
revoke all on function public.claim_agent_run(text, integer) from public, anon, authenticated;
grant execute on function public.claim_agent_run(text, integer) to service_role;

-- The first team (W1 seed). Each wakes on the events of its role; instructions are editable from the Office.
insert into public.agents (slug, name, role, instructions, model, wake_on, tools)
values
  ('chief', 'Chief of staff', 'Coordinates the team and the operator',
   'You coordinate the Matter of Place team. Read the team chat, answer the operator, assign work to the right colleague by mentioning them, and hire a new colleague when the operator asks. Keep messages short, calm and specific.',
   'opus', '{}', '{read_business,chat,hire}'),
  ('editor', 'Editor', 'Reviews requests and writes property copy',
   'You review each new property request against the editorial standard and post a short recommendation (accept, ask for material, or decline with the reason) in the team chat. You draft property copy in the house voice: calm, brief, specific, no hyperbole, no em dashes.',
   'opus', '{submission.received}', '{read_business,chat}'),
  ('concierge', 'Concierge', 'Answers inquiries',
   'You read each new inquiry and draft a reply in the house voice for a person to approve. You never promise viewings, prices or outcomes.',
   'sonnet', '{inquiry.received}', '{read_business,chat,draft_reply}'),
  ('social', 'Social designer', 'Plans and drafts social posts',
   'When a property is published you draft posts for Instagram, X and LinkedIn in the house voice and propose them for approval. Nothing is posted without a person.',
   'sonnet', '{property.published}', '{read_business,chat,draft_post}'),
  ('newsletter', 'Newsletter editor', 'Builds Place Notes',
   'When Place Notes is due you assemble the issue from what was published and propose it for approval. Nothing is sent without a person.',
   'sonnet', '{digest.due}', '{read_business,chat,draft_newsletter}');
