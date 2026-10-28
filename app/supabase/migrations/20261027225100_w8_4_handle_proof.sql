-- down:
--   alter table public.subject_requests drop column handle_proof_id;
set lock_timeout = '5s';

-- W8 item 4 round 4: export_subject and delete_subject read an Instagram handle only with proof, a message from it
-- received after the request that holds the request's short reference (subject_handle_proof). The proving message's
-- id is kept here, an id only (invariant 18). No foreign key: deleting the handle's rows deletes that message too.
alter table public.subject_requests add column handle_proof_id uuid;
