-- down: delete from public.email_templates where key = 'newsletter_welcome';
set lock_timeout = '5s';

-- The welcome a subscriber gets once, right after confirming (operator, 2026-10-15: "make sure that we have a slot in
-- place for the newsletter stuff for when people sign up for it"), in B5's row shape (G46). The same copy as
-- src/templates/email/newsletter-welcome.tsx; the template file draws the slot under it (the lead piece of the latest
-- Place Notes issue sent, or a quiet line while none has gone out). It is sent by a `send_email` step of the
-- `subscriber.confirmed` recipe, which the orchestrator adds. An edited row survives a replay.
insert into public.email_templates (key, class, subject, preheader, body, variables, enabled)
values (
  'newsletter_welcome', 'transactional', 'Welcome to Matter of Place',
  'What we will send you, and how often.',
  '[
    {"type": "heading", "text": "Thank you for confirming."},
    {"type": "paragraph", "text": "Matter of Place publishes existing homes in California, New York and Florida, one at a time, each chosen for what it is rather than what it costs."},
    {"type": "paragraph", "text": "{{what_you_receive}}"},
    {"type": "paragraph", "text": "We write only when there is something to read. If you would rather not hear from us, reply to this email at any time and we will take you off the list."}
  ]',
  '{what_you_receive,market_names,latest_number,latest_title,latest_line,latest_url}', true
)
on conflict (key) do nothing;
