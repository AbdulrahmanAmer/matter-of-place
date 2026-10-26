-- down:
--   drop table public.studio_pieces;
set lock_timeout = '5s';

-- W8 0f (the studio folder): one small row per piece of work in `~/.mop-workforce/studio/<date>-<name>/` on the
-- operator's laptop, so the admin screen can list the studio without the laptop being reachable. The folder is the
-- piece (its brief, every draft, status.md); this row only tracks it: title, owner, state, the folder's name, a note
-- (the piece's `Next:` line) and, once a piece waits on the operator, the Storage key of its small preview (a still in
-- the private `submissions` bucket) and, once it is approved and uploaded, the pending visual it became. Written only
-- by studio_piece_put under the service role (the laptop runner); staff read it.
create table public.studio_pieces (
  -- the id of the piece's brief.json, so the folder and the row name each other
  id uuid primary key,
  title text not null check (char_length(title) between 1 and 120),
  owner_slug text not null check (owner_slug ~ '^[a-z0-9-]{1,40}$'),
  -- queued: waits for the runner (or for a revision Matter asked for); working: being made; draft: passed the gate
  -- and the review, waits for Matter; waiting_operator: Matter asked the operator; approved: the runner uploads it
  -- once; done: uploaded and recorded (or kept in the studio when it has no subject on the site); failed.
  state text not null check (state in (
    'queued', 'working', 'draft', 'waiting_operator', 'approved', 'done', 'failed'
  )),
  -- the folder's name under the studio, never a path
  folder text not null unique check (folder ~ '^[a-z0-9][a-z0-9-]{0,99}$'),
  preview_key text check (char_length(preview_key) <= 200),
  asset_id uuid references public.assets (id) on delete set null,
  note text not null default '' check (char_length(note) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index studio_pieces_state_idx on public.studio_pieces (state, updated_at desc);
-- R24: every foreign key leads an index (a deleted asset sets this column to null by it)
create index studio_pieces_asset_id_idx on public.studio_pieces (asset_id);

alter table public.studio_pieces enable row level security;
revoke all on table public.studio_pieces from anon, authenticated;
grant select on table public.studio_pieces to authenticated;
grant all on table public.studio_pieces to service_role;
create policy studio_pieces_select_staff on public.studio_pieces for select to authenticated using (app.is_staff());
