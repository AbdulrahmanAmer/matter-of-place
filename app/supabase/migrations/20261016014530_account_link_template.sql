-- down: delete from public.email_templates where key = 'account_link';
set lock_timeout = '5s';

-- W6 item 7, ruling H119 (4): the client's sign-in link, in B5's row shape (G46). The same copy as
-- src/templates/email/account-link.tsx. It is sent by a `send_email` job the client room's sign-in form queues for an
-- address that is a contact; the step makes the link when it runs, so no token is stored. An edited row survives a
-- replay.
insert into public.email_templates (key, class, subject, preheader, body, variables, enabled)
values (
  'account_link', 'transactional', 'Your link to sign in to Matter of Place',
  'It works once and for one hour.',
  '[
    {"type": "heading", "text": "Your account"},
    {"type": "heading", "text": "is one step away."},
    {"type": "paragraph", "text": "Use the button below to sign in and see the requests you have sent us. The link works once and for one hour."},
    {"type": "button", "label": "Sign in", "url": "{{sign_in_url}}"},
    {"type": "paragraph", "text": "If you did not ask for it, ignore this email and nothing will change."}
  ]',
  '{sign_in_url}', true
)
on conflict (key) do nothing;
