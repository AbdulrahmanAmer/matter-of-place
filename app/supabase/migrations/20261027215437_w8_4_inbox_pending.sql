-- down:
--   alter table public.social_inbox_cursors drop column pending;
set lock_timeout = '5s';

-- W8 item 4 round 3: Graph documents no order for comments, replies, conversations or messages, so each list is read
-- to its end. A list that a read's caps cut short is kept here with Graph's `after` cursor, keyed by the node whose
-- list it is (a post, a comment, our Page, a conversation), with the time it is read back to and when its read began
-- (meta-inbox.ts `Pending`). The next read resumes it first, so every read makes progress. Written only by
-- social_inbox_record, in the same transaction as the rows it read.
alter table public.social_inbox_cursors add column pending jsonb not null default '{}'::jsonb
  check (jsonb_typeof(pending) = 'object');
