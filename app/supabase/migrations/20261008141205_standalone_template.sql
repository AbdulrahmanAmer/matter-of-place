-- down: update public.email_templates set subject = 'Matter of Place', preheader = '', body = '[{"type": "paragraph", "text": "The Campaign email of a property is written for that property before it is sent."}]', variables = '{}', enabled = false where key = 'standalone';
set lock_timeout = '5s';

-- B11 steps 4 and 9 (invariant 9): the final `standalone` row. The property block is drawn by
-- src/templates/email/standalone.tsx from the variable `block`, so the row holds no blocks of its own. Applied only
-- while the row is still B5's seed, so a row an admin has edited survives a replay. The revision carries the note B11.
do $$
begin
  if exists (
    select 1 from public.email_templates
    where key = 'standalone' and enabled = false and subject = 'Matter of Place' and variables = '{}'
  ) then
    perform set_config('mop.note', 'B11', true);
    update public.email_templates set variables = '{subject,preheader,block}' where key = 'standalone';
    perform public.automation_put_template(
      'standalone',
      '{"subject": "{{subject}}", "preheader": "{{preheader}}", "body": [], "enabled": true}'::jsonb,
      null, null, 'B11', 'B11'
    );
    perform set_config('mop.note', '', true);
  end if;
end;
$$;
