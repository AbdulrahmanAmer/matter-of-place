# Delegation: how Matter hands a plan item to a builder

Operator, 2026-10-15: Matter goes parallel, without repeating the builders that did poor work. Today's evidence says
the quality of a builder's work is the quality of its brief: the W9 builder (a sharp brief, one item per PR, tests) gave
five PRs that merged; the first email redesign (a vague brief that let it keep the old structure) gave two hours of
the wrong thing. Parallel is safe when every builder has one item, its own files, a written definition of done, and is
looked at early. This file is how.

## 1. What Matter keeps, what he hands out

- **Matter builds himself:** every item marked CRITICAL (W8 section 0: 0a to 0d; anything touching database security
  rules, sign-in and permissions, job claiming, payment state, cryptography, the launch switch), on Opus 5.5 at high
  effort, each reviewed by a fresh Opus 5.5 reviewer before the gate.
- **A builder takes:** a non-critical item whose files no other running work touches (W7 sections A to D screens, the
  remaining W6 items that are not security, W8 items after section 0). Builders run on **Sonnet 5.5 at high effort**
  (CLAUDE.md model routing); Opus only for an item the plan marks critical or that failed once on Sonnet.
- **Never handed out:** a decision that is the operator's, anything needing the operator's accounts (Meta app, social
  logins), and two items that touch the same file, table, migration or route.

## 2. Before writing a brief (Matter, 10 minutes, not skipped)

1. Read the plan item on origin/main word for word, and the plan's own proof line for it.
2. Check what already exists: `git log --oneline origin/main -- <the files the item names>` and `gh pr list --state
   merged --search "<key word>"`. Today W9 item 2 already shows bounces on a person's page; W7 item 1 (sent email log)
   must extend that, not rebuild it. Write what exists into the brief.
3. List the files the builder will own. Compare with every running builder's list and with your own current work:
   any overlap means the item waits.
4. Decide what you already know that the builder must not re-measure (ids, paths, rulings, which table holds what).

## 3. The brief (one item, filled in, written to ~/.mop-workforce/builders/<item>/brief.md)

```
You are the builder of <PLAN> item <N> for Matter of Place. You run as a headless Claude Code session started by
Matter, pinned to <model>. Nobody watches this session: work to the end without stopping to ask.

## The item (verbatim from workspace/05-plans/<PLAN>.md on origin/main)
<the item's full text, copied, not summarised>

## Done means
- <the plan's proof command> prints <the expected line>.
- <what a person sees: the screen, the admin path, the email, the row>, observed by you (a screenshot path, or the
  query and its output).
- Tests for the new behaviour, each with a registry entry that `node scripts/watchfail.mjs --registry tests/mutations
  --only <id>` shows WATCHED-FAIL OK.
- The plan item ticked in the same PR: `- [x]` plus an indented `Done <date> (PR <n>): <what was observed>` line.

## What Matter already knows (do not re-measure)
- <facts: what exists already and must be extended, ids, tables, rulings, decided answers to open questions>

## Your files, and the ones you must not touch
- Yours: <paths>. Another builder owns <paths>; Matter owns <paths>. Need a file outside yours: stop and say so in
  the PR, do not edit it.

## Checkpoint
Within your first 30 minutes of work, push your branch and open a DRAFT pull request titled
"<PLAN> <N> (draft): <one line>" with the first real diff. Matter reads it and may stop you. Then continue.

## How (the repository's rules)
<the "How" block of the W9 brief, unchanged: CLAUDE.md, app/AGENTS.md, check-gotchas, one path per kind of change,
migrations and db:fn, edit-impact after every edit, before each push both tsc configs, eslint, prettier, knip, the
tests that import your files, check-migrations, the registry; the senior way: the smallest change in the right place,
extend what exists, never a second pipeline. Worktree rules, scripts in files, background long commands, no secrets,
no force-push. Run only the tests for your files locally: CI runs the full suite, and a timeout under the laptop's load
is not a failure (G-031).>

## Final message
The PR link, what changed, the commands you ran with their real result lines, how it was observed working, anything
NOT DONE with the reason, the data changes Matter must make that are not code, and one line `MEMORY: <lesson>`.
```

## 4. Launching (and proving the model)

From the builder's own worktree (`git -C "E:\Matter Of Place" worktree add -b <branch> E:\mop-build\<name> origin/main`):

```
cat ~/.mop-workforce/builders/<item>/brief.md | claude -p --model claude-sonnet-5-5 --effort high \
  --permission-mode dontAsk --settings E:/mop-build/live/app/scripts/matter/settings-full.json \
  --output-format stream-json --verbose > ~/.mop-workforce/builders/<item>/run.jsonl 2> ~/.mop-workforce/builders/<item>/run.err
```

Run it in the background. Then check the process command line names the model and `--effort high`. Write the item,
its owned files, the branch and the start time to `~/.mop-workforce/builders/running.json`.

## 5. Limits

- **At most two builders at once**, besides Matter. The laptop is shared; a third makes everyone's tests time out.
- **Budget:** read `~/.mop-workforce/policy.json` before each launch. Week above 80% used: launch nothing new; let
  running builders finish.
- **Two failed attempts on the same obstacle end the builder:** stop it, record `BLOCKED: <obstacle> - <what would
  unblock it>` in the PR, and either rebrief with what was learned or take the item yourself.

## 5b. No local CI (operator, 2026-10-16)
His words: "can we just stop using the local ci run? since we are staying public on git for some time till we are done with
everything regarding the building process" and "saves us time and frees up the hardware from load so it is more focused on
building the code itself". The repository is public, so GitHub's CI is free; it runs on pull requests to `main`. From 2026-10-16:
- The one pull request of overdrive is opened as a DRAFT from `overdrive/finish` into `main` as soon as it has content. Every push
  to `overdrive/finish` makes GitHub run the full CI on it (check, build, bundle-check, db, `watchfail --changed`, e2e, SEO).
- Nobody runs CI on the laptop, builders and Matter alike: never `bun run check`, `tsc`, `eslint`, `knip`, `prettier --check`, the
  full test suite, `bun run build` or `watchfail` locally. A builder may run the one test file it is writing, and format its own
  files with `prettier --write`.
- Matter merges a builder's branch into `overdrive/finish` when its fresh Opus review passes (the review reads the diff; it does
  not run checks), pushes, and reads the draft's result with `gh pr checks`. A red job goes back to the item's builder with CI's
  own output; the builder fixes forward on its branch.
- When every in-flight item is merged and the draft's CI is green, it is marked ready and merged through the gate
  (`node workspace/05-plans/merge-gate.mjs <pr>`), never `gh pr merge`.

## 6. Review and merge (Matter, every PR)

1. **The draft (within 30 minutes):** does the diff build the item, in the files named, extending what exists? If it
   drifts, stop the builder, fix the brief, start again. A wrong direction caught here costs minutes.
2. **The finished PR:** read the diff against the item's text and the "Done means" list. Each claim needs its proof
   line in the PR (command and real output). A claim without its proof is NOT DONE.
3. **Critical items:** a fresh Opus 5.5 reviewer reads the diff before the gate; its findings are fixed first.
4. Merge through the gate. Then make any data change the builder listed, tick-check the goal
   (`node .claude/hooks/task-gate.mjs status ~/.mop-workforce/matter/goal.json`), and start the next builder.
