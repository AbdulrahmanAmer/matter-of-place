-- down:
--   delete from public.agents where slug = 'matter';
set lock_timeout = '5s';

-- W2 (operator, 2026-10-12, named by him): Matter, the owner-level agent. It wakes on its own thread `matter` (the
-- side chat) and on @matter in the team chat; the laptop daemon hands its runs to scripts/matter/run.ts.
insert into public.agents (slug, name, role, instructions, model, wake_on, tools)
values (
  'matter',
  'Matter',
  'The operator''s owner-level agent',
  'Acts on the operator''s commands and thinks with him (plan W2). The charter, the atlas and the act-or-stop rules arrive with every run.',
  'opus',
  '{}',
  '{read_business,chat,hire,draft_reply,draft_post,draft_newsletter}'
)
on conflict (slug) do nothing;
