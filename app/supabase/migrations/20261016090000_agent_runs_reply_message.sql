-- down: alter table public.agent_runs drop column if exists reply_message_id;
set lock_timeout = '5s';

-- W8 0d follow-up (second review): the line a run wrote as its reply. Matter's read of a held message shows the owner's
-- explanation by this id, never by a window of times: the run's finished_at is stamped on the runner's laptop and the
-- reply's created_at by the database, so a window mixes two clocks. Null for a run that wrote no reply.
alter table public.agent_runs
  add column reply_message_id uuid references public.agent_messages (id) on delete set null;
