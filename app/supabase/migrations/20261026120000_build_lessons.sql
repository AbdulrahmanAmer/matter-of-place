-- down:
--   delete from public.agent_lessons where source = 'build';
--   drop index public.agent_lessons_build_pr;
--   alter table public.agent_lessons drop constraint agent_lessons_source_check;
--   alter table public.agent_lessons add constraint agent_lessons_source_check
--     check (source in ('decline', 'edit', 'outcome', 'matter'));
set lock_timeout = '5s';

-- W6 item 4: what Matter learns from building. Each pull request he merges writes one lesson (what broke in CI, what
-- fixed it) with source 'build' and evidence_ref 'pr:<number>'. The second source of lessons after the operator's
-- decisions; recalled by the same path (recallLessons, lessonsBlock). One lesson per pull request, however often the
-- runner reads the merge.
alter table public.agent_lessons drop constraint agent_lessons_source_check;
alter table public.agent_lessons add constraint agent_lessons_source_check
  check (source in ('decline', 'edit', 'outcome', 'matter', 'build'));

create unique index agent_lessons_build_pr on public.agent_lessons (evidence_ref) where source = 'build';
