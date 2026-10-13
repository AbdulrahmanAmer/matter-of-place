-- down: alter table public.subscribers drop column confirm_token_at;
-- Gap audit item 24: a confirmation link lives 7 days from when it was issued, not as long as the unconfirmed row.
-- `confirm_token_at` is when the current `confirm_token_hash` was stored; a hash already waiting takes the best time
-- the row has.
set lock_timeout = '5s';

alter table public.subscribers add column confirm_token_at timestamptz default now();

update public.subscribers
set confirm_token_at = coalesce(repermission_sent_at, updated_at, created_at)
where confirm_token_hash is not null;
