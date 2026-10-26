-- down:
--   alter table public.submission_media drop column declared_at;
set lock_timeout = '5s';

-- W6 item 8 (ruling H142): when a photograph was declared, which is when its signed upload URL was made. The `reconcile`
-- job reads and ages a waiting photograph by this time, not by when its request arrived: a photograph a client adds from
-- the room to a request received a week ago is settled like one sent with the form. Rows already there were declared
-- with their request.
alter table public.submission_media add column declared_at timestamptz not null default now();
update public.submission_media m set declared_at = s.received_at
from public.submissions s where s.id = m.submission_id;
create index submission_media_waiting_idx on public.submission_media (declared_at) where uploaded_at is null;
