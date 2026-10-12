-- down:
--   delete from public.agents where slug in ('analyst', 'campaigns');
--   drop table if exists public.agent_decisions;
set lock_timeout = '5s';

-- W2 step 7 (contract 9 to 15): the core brain. Every day at 18:00 Cairo time the team meets in the team chat; Matter
-- ends it with at most five decisions, each with an owner, a due date and the number that proves it. The next meeting
-- opens with them marked done or missed, and between meetings each colleague works its open decisions (its backlog).

create table public.agent_decisions (
  id uuid primary key default gen_random_uuid(),
  meeting_on date not null,
  owner_id uuid not null references public.agents (id) on delete cascade,
  decision text not null check (char_length(decision) between 3 and 500),
  due_on date not null,
  metric text not null check (char_length(metric) between 1 and 200),
  status text not null default 'open' check (status in ('open', 'done', 'missed')),
  checked_at timestamptz,
  created_at timestamptz not null default now()
);
create index agent_decisions_owner_status on public.agent_decisions (owner_id, status);

alter table public.agent_decisions enable row level security;
-- G-100: every grant is explicit. Staff read; the laptop runner writes under the service role.
revoke all on table public.agent_decisions from anon, authenticated;
grant all on table public.agent_decisions to service_role;
grant select on table public.agent_decisions to authenticated;
create policy agent_decisions_select_staff on public.agent_decisions for select to authenticated
  using (app.is_staff());

-- The two colleagues of the core brain (contract 9 and 10). The Analyst reads the numbers and the competition before
-- every meeting; Campaigns plans paid campaigns, whose every budget and live ad waits for the operator's yes.
insert into public.agents (slug, name, role, instructions, model, wake_on, tools)
values
  ('analyst', 'Analyst', 'Reads the numbers and the competition for the meeting',
   'Before each meeting you read the scorecard (eight numbers against last week) and say at most three things that matter, each tied to a number. You research competitors daily and write a short list of what changed; once a week you go deeper on one. You keep what the company learns in the knowledge base. You never invent a number: when one is missing you say it is not measured.',
   'sonnet', '{}', '{read_business,chat,research}'),
  ('campaigns', 'Campaigns', 'Plans paid campaigns and media buying',
   'You plan paid campaigns for Matter of Place and its featured properties: the audience, the channel, the creative brief, the ad copy and the budget, each with the number that will prove it worked. Every budget and every live ad is a proposal the operator approves; you never spend. You read the results into the knowledge base. The aim is reach and sales that compound; say plainly when something is not working.',
   'sonnet', '{}', '{read_business,chat,draft_campaign}')
on conflict (slug) do nothing;
