-- down:
--   drop index public.social_inbox_approval_idx;
--   alter table public.social_inbox drop constraint social_inbox_social_post_id_fkey,
--     add constraint social_inbox_social_post_id_fkey foreign key (social_post_id) references public.social_posts (id);
set lock_timeout = '5s';

-- W8 item 4, CI round (STANDARDS R24: every foreign key states on delete and leads an index).
-- A comment's post: set null. A social_posts row goes when its asset or property is deleted, but the comment is still a
-- person's words on our account, kept under its own retention (one year) and erasure; the reply needs only the comment's
-- Graph ids, and every reader of social_post_id already takes null (proposed_posts.social_post_id does the same).
alter table public.social_inbox drop constraint social_inbox_social_post_id_fkey,
  add constraint social_inbox_social_post_id_fkey foreign key (social_post_id)
    references public.social_posts (id) on delete set null;

-- The approval already sets null on delete (retention of decided approvals); this is its index.
create index social_inbox_approval_idx on public.social_inbox (approval_id) where approval_id is not null;
