-- down:
--   drop trigger settings_email_share on public.settings; drop function public.settings_email_share();
--   delete from public.settings where key = 'email';
--   delete from public.email_templates where key in ('received', 'declined', 'accepted', 'awaiting_assets', 'invoice',
--     'inquiry_ack', 'inquiry_forward', 'interest_confirm', 'newsletter_confirm', 'admin_notify', 'standalone',
--     'subject_ack', 'repermission');
set lock_timeout = '5s';

-- B5 step 2: one row per key of B5's set (G46), its class (INT-03) and its variables (variablesByKey). Configuration,
-- so production carries it; an insert skips a key that exists, so an edited row survives a replay. The copy is the
-- plan's seed copy, ASSUMED; the CEO edits it in screen 18. standalone is disabled until B11 sends it.
insert into public.email_templates (key, class, subject, preheader, body, variables, enabled)
values
  (
    'received', 'transactional', 'We have your submission', 'We will review it and be in touch.',
    '[
      {"type": "heading", "text": "Thank you, {{submitter_name}}."},
      {"type": "paragraph", "text": "We have received {{property_address}}, {{city}}, {{state}}. We will review it against our editorial standard and be in touch."},
      {"type": "paragraph", "text": "Editorial consideration is free. Nothing is charged unless the property is accepted and you choose a product."},
      {"type": "signature"}
    ]',
    '{submitter_name,property_address,city,state,package}', true
  ),
  (
    'declined', 'transactional', 'About {{property_address}}', '',
    '[
      {"type": "heading", "text": "Thank you for submitting {{property_address}}."},
      {"type": "paragraph", "text": "After careful reading, we will not be featuring this property at this time."},
      {"type": "paragraph", "text": "{{reason_paragraph}}"},
      {"type": "paragraph", "text": "{{note_paragraph}}"},
      {"type": "paragraph", "text": "You have not been charged. You are welcome to submit another property."},
      {"type": "signature"}
    ]',
    '{submitter_name,property_address,reason_label,reason_paragraph,note_paragraph}', true
  ),
  (
    'accepted', 'transactional', '{{property_address}} has been accepted', '',
    '[
      {"type": "heading", "text": "Your property has been selected."},
      {"type": "paragraph", "text": "We would be glad to feature {{property_address}}, {{city}}, {{state}}."},
      {"type": "paragraph", "text": "An invoice for {{package}} will follow. Once payment is confirmed we schedule the property."},
      {"type": "signature"}
    ]',
    '{submitter_name,property_address,city,state,package}', true
  ),
  (
    'awaiting_assets', 'transactional', 'Materials for {{property_address}}', '',
    '[
      {"type": "heading", "text": "A little more, please."},
      {"type": "paragraph", "text": "To continue with {{property_address}} we need the following."},
      {"type": "paragraph", "text": "{{assets_note}}"},
      {"type": "paragraph", "text": "Reply to this email with the files or a link."},
      {"type": "signature"}
    ]',
    '{submitter_name,property_address,assets_note}', true
  ),
  (
    'invoice', 'transactional', 'Invoice {{invoice_number}} from Matter of Place', '',
    '[
      {"type": "heading", "text": "Invoice {{invoice_number}}"},
      {"type": "facts", "rows": [
        {"label": "Property", "value": "{{property_address}}"},
        {"label": "Product", "value": "{{product}}"},
        {"label": "Amount", "value": "{{amount}}"},
        {"label": "Terms", "value": "{{terms}}"},
        {"label": "Preferred payment method", "value": "{{preferred_method}}"}
      ]},
      {"type": "paragraph", "text": "How to pay"},
      {"type": "paragraph", "text": "{{payment_instructions}}"},
      {"type": "paragraph", "text": "Your property is scheduled once payment is confirmed. The invoice is attached."},
      {"type": "paragraph", "text": "Questions about this invoice: {{billing_email}}."},
      {"type": "signature"}
    ]',
    '{submitter_name,property_address,invoice_number,product,amount,terms,preferred_method,payment_instructions,billing_email}',
    true
  ),
  (
    'inquiry_ack', 'transactional', 'We have your message', '',
    '[
      {"type": "heading", "text": "Thank you, {{name}}."},
      {"type": "paragraph", "text": "A person will reply within one working day."},
      {"type": "signature"}
    ]',
    '{name}', true
  ),
  (
    'inquiry_forward', 'transactional', 'A message about {{property_title}}', 'Sent through Matter of Place.',
    '[
      {"type": "heading", "text": "A message about {{property_title}}"},
      {"type": "paragraph", "text": "{{inquirer_name}} wrote to you through Matter of Place:"},
      {"type": "paragraph", "text": "{{message}}"},
      {"type": "paragraph", "text": "You can reach them at {{inquirer_contact}}."},
      {"type": "paragraph", "text": "Matter of Place passes the message on and does not take part in the conversation."},
      {"type": "signature"}
    ]',
    '{submitter_name,property_title,inquirer_name,inquirer_contact,message}', true
  ),
  (
    'interest_confirm', 'transactional', 'Confirm your interest in {{market_names}}', '',
    '[
      {"type": "heading", "text": "Confirm your interest."},
      {"type": "paragraph", "text": "You asked to hear when Matter of Place publishes its first property in {{market_names}}."},
      {"type": "button", "label": "Confirm", "url": "{{confirm_url}}"},
      {"type": "paragraph", "text": "If this was not you, ignore this email and nothing will be sent."}
    ]',
    '{market_names,confirm_url}', true
  ),
  (
    'newsletter_confirm', 'transactional', 'Confirm your Place Notes subscription', '',
    '[
      {"type": "heading", "text": "One click to confirm."},
      {"type": "paragraph", "text": "Place Notes brings selected properties and stories from California, New York and Florida, about every two weeks."},
      {"type": "button", "label": "Confirm", "url": "{{confirm_url}}"},
      {"type": "paragraph", "text": "If this was not you, ignore this email and nothing will be sent."}
    ]',
    '{confirm_url}', true
  ),
  (
    'admin_notify', 'alert', '{{headline}}', '',
    '[
      {"type": "heading", "text": "{{headline}}"},
      {"type": "paragraph", "text": "{{summary}}"},
      {"type": "button", "label": "Open in admin", "url": "{{link_url}}"}
    ]',
    '{headline,summary,link_url}', true
  ),
  (
    'standalone', 'bulk', 'Matter of Place', '',
    '[
      {"type": "paragraph", "text": "The Campaign email of a property is written for that property before it is sent."}
    ]',
    '{}', false
  ),
  (
    'subject_ack', 'transactional', 'We have your privacy request', 'We will answer by {{due_date}}.',
    '[
      {"type": "heading", "text": "We have your request."},
      {"type": "paragraph", "text": "We received your {{kind_label}} request and will answer by {{due_date}}, within 45 days of receiving it."},
      {"type": "paragraph", "text": "To confirm it is you, we may ask you to reply from this address."},
      {"type": "signature"}
    ]',
    '{kind_label,due_date}', true
  ),
  (
    'repermission', 'bulk', 'Do you still want Place Notes?', 'One click keeps you on the list.',
    '[
      {"type": "heading", "text": "Still reading?"},
      {"type": "paragraph", "text": "It has been a year since you confirmed or last clicked a link in Place Notes."},
      {"type": "paragraph", "text": "If you would like to keep receiving it, confirm below."},
      {"type": "button", "label": "Keep me subscribed", "url": "{{confirm_url}}"},
      {"type": "paragraph", "text": "If we do not hear from you, we will remove you from the list. You can subscribe again at any time."}
    ]',
    '{confirm_url}', true
  )
on conflict (key) do nothing;

-- Invariant 5: the share of the one Resend account for the stage the database is in now. The trigger below keeps it
-- in step with every later change of settings.environment (ruling H35 (4)).
insert into public.settings (key, value)
select 'email', case
  when (select s.value #>> '{}' from public.settings s where s.key = 'environment') = 'production'
    then '{"daily_cap": 75, "bulk_cap": 50, "monthly_cap": 2600, "dev_recipients": []}'::jsonb
  else '{"daily_cap": 15, "bulk_cap": 5, "monthly_cap": 300, "dev_recipients": ["admin@matterofplace.com", "admin+*@matterofplace.com", "*@resend.dev"]}'::jsonb
end
on conflict (key) do nothing;

create or replace function public.settings_email_share()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Invariant 5, ruling H35 (4): the stage and its share of the one Resend account change in one transaction, so the
  -- launch switch's set_environment('production') moves settings.email to the production share.
  update public.settings
  set value = case
    when new.value #>> '{}' = 'production'
      then '{"daily_cap": 75, "bulk_cap": 50, "monthly_cap": 2600, "dev_recipients": []}'::jsonb
    else '{"daily_cap": 15, "bulk_cap": 5, "monthly_cap": 300, "dev_recipients": ["admin@matterofplace.com", "admin+*@matterofplace.com", "*@resend.dev"]}'::jsonb
  end
  where key = 'email';
  return null;
end;
$$;

revoke execute on function public.settings_email_share() from public, anon, authenticated;

create or replace trigger settings_email_share
after update of value on public.settings
for each row when (new.key = 'environment')
execute function public.settings_email_share();
