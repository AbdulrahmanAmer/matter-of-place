# Second round (operator, 2026-10-16)

The operator's order, his words: "just don't start anything in the queue after the running work". Overdrive's scope is frozen to what
is merged or in flight on 2026-10-16: W7 items 4, 7; W6 item 7; W8 items 0d, 9, 10, 11, 0g, 0h, 0i; the W7 item 9 rounds; the
template fixes, the H110 reel fix and the runner faults. Everything below waits for a second round, after the weekly allowance resets
(Wednesday 2026-10-21 19:00). Each item keeps its brief in `second-round/briefs/` (copied from the builder briefs) so it launches as
written. Nothing here is built; every item is `[ ]` in its plan with a Waiting line pointing here.

| Plan | Item | What | Brief |
|---|---|---|---|
| W7 | 1 | Sent email log | `second-round/briefs/w7-1.md` |
| W6 | 4 | Matter's lessons from building | `second-round/briefs/w6-4.md` |
| W6 | 5 | W4 finished by Matter: replies visible to the team | `second-round/briefs/w6-5.md` |
| W6 | 6 | Matter verifies the global hooks reach his own runs | `second-round/briefs/w6-6.md` |
| W6 | 8 | The room's pages, in order (after item 7, the client room) | `second-round/briefs/w6-8.md` |
| W8 | 0f | The studio folder | `second-round/briefs/w8-0f.md` |
| W8 | 1 | Brand posts without a property (CRITICAL: nullable assets.property_id, approve guard, RLS) | `second-round/briefs/w8-1.md` |
| W8 | 3 | The captions runner on a schedule | `second-round/briefs/w8-3.md` |
| W7 | 8 | Interest by market (after W7 item 9 merges) | `second-round/briefs/w7-8.md` |
| W7 | 10 | Site numbers for the Analyst (after W7 item 9 merges) | `second-round/briefs/w7-10.md` |
| W7 | 11 | What happened to their proposals (after W7 item 9 merges) | `second-round/briefs/w7-11.md` |
| W7 | 12 | Email delivery for the Concierge (after W7 item 9 merges) | `second-round/briefs/w7-12.md` |
| W7 | 14 | Campaigns wakes on a confirmed signup (after W7 item 9 merges) | `second-round/briefs/w7-14.md` |
| W8 | 2 | A Social proposal becomes a real draft (largely superseded by items 10 and 11; re-read it against them first) | none (read the item) |

Launch order for the second round: the Opus items first (W8 1), then W6 and W8 items, then the W7 items that build on item 9's briefing.

## Parked (operator, 2026-10-16, his words: "now we are going to be able to properly park work and chill and only they can wake up when
some sort of work is in place regarding MOP so basically now we can relax on build and wait for something to happen")

The build is parked at its boundary; nothing was killed. The five builders launched at 17:12 finish their current item, push their branch
and stop; no review, fix round or new builder starts until the operator says build again (the STOP file holds the slot filler; Matter's
goal steps are off through `backlog: "off"` in `~/.mop-workforce/config.json`). The team works only on real Matter of Place work: a
person's line, a new submission, inquiry or subscriber, an approval, and the scheduled jobs (meeting, captions, backup, the Saturday audit).

Where each item of `overdrive/finish-2` (PR 449) stands, and what resumes it:

| Item | Branch | State at the park | Next step when the build resumes |
|---|---|---|---|
| Follow-ups round 2 (W8 0d, W6 7, W7 7) | merged into finish-2 | fresh Opus review PASS; Matter's fix of its medium on finish-2 | read PR 449's CI |
| Follow-ups round 3 (the review's leftovers) | `overdrive/followups-b` | builder `followups-fix3` (Sonnet) running at the park | fresh Opus review, then merge |
| W8 10, a home for proposed posts | `overdrive/w8-10` | built; review FAILED (agentRoles); builder `w8-10-fix` (Opus) running | fresh Opus review, then merge, then W8 11 |
| W8 11, the Proposed posts screen | `overdrive/w8-11` (55d14e2d) | built, not reviewed; waits on W8 10 | merge W8 10 into it, fresh review, merge; then load the Fairfield set (TEST) and reject it by Matter's key |
| W8 0h, every inbound email is seen | `overdrive/w8-0h` | review FAILED twice; builder `w8-0h-fix2` (Opus) running | fresh Opus review, then merge |
| W8 0i, role toolkits | `overdrive/toolkits` | review FAILED twice; builder `toolkits-fix3` (Opus) running | fresh Opus review, merge, the live probes, the Fairfield rerun with nothing by hand |
| W7 9 with 9a and 9b | `overdrive/w7-9` | review FAILED; ruling H132 (the operator's own) settles typed fields; builder `w7-9-fix4` (Opus) running | fresh Opus review, then merge |
| W8 0d live proof | main | code merged (PR 447); unticked | one real outside message with an instruction to an AI, sent by the operator through the contact form or to hello@ |

Each builder's final message is in `~/.mop-workforce/builders/<id>/run.jsonl`; each review prompt is made with
`E:/mop-build/.tmp/od-review-make.py` (REF=origin/overdrive/finish-2) and run with `od-review-run.sh`.
