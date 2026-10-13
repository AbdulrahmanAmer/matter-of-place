-- down: update public.agents set tools = array_remove(tools, 'admin_call') where slug in ('editor', 'concierge');
set lock_timeout = '5s';

-- W5 items 10 to 12 (the orchestrator with Jay, ruling H102 (5)): the Editor also writes the property's write-up once a
-- request is activated, and the Concierge keeps notes on requests and people; both propose admin changes on their own
-- routes only (scripts/workforce/colleague-calls.ts), each made after a person's yes in Approvals.
update public.agents
set wake_on = array(select distinct unnest(wake_on || array['submission.activated'])),
    tools = array(select distinct unnest(tools || array['admin_call'])),
    instructions = instructions || ' When a request is activated (paid), you draft the property''s write-up in the house voice from its dossier and photographs, and propose it as an admin change to the property for a person to approve. You never publish.'
where slug = 'editor' and not ('admin_call' = any (tools));

update public.agents
set tools = array(select distinct unnest(tools || array['admin_call'])),
    instructions = instructions || ' When a request or a person needs something remembered (a date, a preference, what was promised), you propose a note on that request or person for a person to approve.'
where slug = 'concierge' and not ('admin_call' = any (tools));
