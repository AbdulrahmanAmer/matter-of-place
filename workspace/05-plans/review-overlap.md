# Review overlap inside a slice (design, awaiting the operator's sign-off, 2026-10-03)

Goal: hide each group's review (about 9 minutes) behind the next group's build (20 to 30 minutes) without ever having
two writers in the lane folder. Expected gain: a quarter to a third of a slice's wall time. Tokens: about the same.

## The writer queue
- The lane runs one serial chain of writers: build g1, build g2, then any fix or follow-up that has become due,
  build g3, and so on. Nothing writes to the lane folder outside that chain.
- When a build finishes, its commit range (first to last commit the builder reports) goes to a review that runs in a
  snapshot (below). Reviews queue one at a time per lane; builds never wait for them, with one exception: a build whose
  group touches `supabase/migrations`, the seed or `db:push` waits for every pending review first, so the schema of
  `mop-dev` never moves under a reviewer.
- A review that rejects becomes a fix at the front of the writer queue, then a re-review in a fresh snapshot, inside the
  same cap of three fix rounds. A review that passes with follow-ups becomes the follow-up agent in the queue. The slice
  merges only when every review has resolved.
- A fix repairs behaviour inside the group's contract. If the fixer finds it must change something a later group
  already builds on, it returns blocked naming that group, and the workflow queues a re-review of that group. After any
  fix, the full check and the test suite run in the lane before the chain continues.

## The snapshot
- The reviewer receives the first and last commit of the group. `review-snapshot.mjs create <lane> <sha>` makes a
  worktree of the last commit at `E:/mop-build/<lane>-review`, installs from that commit's lockfile, copies the lane's
  `.env` and `.dev.vars`, and assigns the lane's port plus one. The review diffs `first^..last` and reads the plan and
  the bank at that commit.
- The reviewer never runs `db:push`, `db:reset` or the seed: those proofs are the builder's and CI's, and the review
  says so. `review-snapshot.mjs remove` deletes the worktree and its folder (the copied secrets with it);
  `sweep` prunes snapshots older than a few hours and runs before every create.
- If a snapshot cannot be made (disk, port, git lock after one retry), the review runs the old way, in the lane after
  the builder finishes, and the log says so.

## CI and pull requests
- Builders no longer open draft pull requests. The merge agent opens the pull request when the slice is done, waits for
  CI and runs the merge gate. A group whose plan proof is a CI job carries `needsPullRequest: true` in the sizing and
  is the only kind that opens a draft early.

## Flaws looked for and how each is closed
- A review that passed before an earlier group's fix landed: the fixer's contract rule, the post-fix full check, the
  slice-end check and CI.
- Git lock collisions between snapshot creation and the builder's commits: one retry.
- A reviewer that dies or times out: the review is rerun once, sequentially.
- Resume of a stopped run: completed agents replay from cache; promises are rebuilt.
- Load: one review per lane at a time; two test workers per process.
- Measurement: in `agent-cost.mjs`, wall minutes below agent minutes is the overlap.

## Stated limit
No private database per review: the migrations use `pgmq` and `pg_cron`, which the laptop's PostgreSQL does not carry,
and Supabase gives one database per project. Hence the schema rule above.

## Status
Design complete. To be added to `build-slice.js` (writer chain, review promises, the schema wait, `needsPullRequest`)
together with `review-snapshot.mjs`, after the two calibration runs of 2026-10-03 report and the winner is picked, and
proved on one slice before it reaches every lane.
