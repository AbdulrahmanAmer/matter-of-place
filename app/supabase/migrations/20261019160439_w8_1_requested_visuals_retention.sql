-- down:
--   delete from public.retention_policies where key = 'rejected_requested_visuals';
--   The functions come from the fn migration that follows (bun run db:fn): its down is in its own header.
set lock_timeout = '5s';

-- W8 item 1 (GD-03): a visual made on request (a reel or a still post about a market, a story or the brand) has no
-- property to go with, so a rejected one is deleted with its files 90 days after it was last changed, unless a post
-- points at it. The retention job runs it as the `rejected_requested_visuals` step.
insert into public.retention_policies (key, table_name, keep_for, action, enabled, note)
values ('rejected_requested_visuals', 'assets', interval '90 days', 'delete', true,
  'Rejected visuals made on request (no property), with their files under requested/, 90 days after updated_at.')
on conflict (key) do nothing;
