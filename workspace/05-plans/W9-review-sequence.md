# W9: the review sequence of a submitted property

The operator, 2026-10-15: "a sequence for what happens in the review process of a submitted property so we can make the
team able to drive things the right way". This is that sequence: one section per state of a submission
(`submissions.workflow_state`, the graph in `src/domain/workflow.ts`). The Editor and the other colleagues read it from
their brief; a person reads it here. A state moves only through the admin action named for it, which audits it and emits
its event; every email goes from `hello@notify.matterofplace.com` through the `send_email` step, and a reply goes to the
reply-to address in Admin > Settings.

Who is who: **the Editor** is the colleague who owns submissions (it wakes on `submission.received`); **Matter** decides
what colleagues propose in Approvals; **the operator** (or a chief or managing editor) is the person whose approval a
step needs. A colleague never decides a request, never sends money and never publishes: it proposes, Matter or a person
decides.

The address comes first in every state: if an email about the request bounced (W9 item 2 shows it on the request page,
W9 item 3 wakes the Editor with `email.bounced`), nothing else moves until the right address is known. The Editor
proposes a call (when there is a phone) or a way to ask for the right address, as a note on the request; a person
corrects the address on the request page and sends the email again.

## Submitted

- **Starts it**: the public form `/submit` (`create_submission`), which emits `submission.received`.
- **Owner**: the Editor, woken by `submission.received`.
- **Checks**, in this order: the address (did the confirmation reach them; W9 item 1 checked it at the form); the rights
  (`rights_confirmed_at` is set; without it nothing is pulled or used); the markets (California, New York or Florida,
  existing residential, not a development); the photographs (attached, or a listing or photography link to pull them
  from, W9 item 4); duplicates (the request page flags a possible duplicate).
- **Email**: `received` (the confirmation) to the submitter, and `admin_notify` to the team, by the
  `submission.received` recipe.
- **Matter decides**: whether the review starts now (the Editor proposes it with what it found).
- **Operator approves**: nothing yet.
- **Moves on**: "Start review" (`submissions.start_review`; Admin > Requests > the request, or the Editor's proposal of
  `POST /api/admin/submissions/start-review` once Matter approves it) moves it to Under Review.

## Under Review

- **Starts it**: Start review from Submitted, or Material received from Awaiting Assets.
- **Owner**: the Editor.
- **Checks**: the editorial standard (`/editorial-standard`: design, setting, story; price never equals merit); the
  rights again; whether the photographs are enough to judge and to publish; the package asked for and what it costs.
- **Email**: none on entry.
- **Matter decides**: the recommendation the Editor proposes (accept, decline with a reason, or ask for material), as a
  note on the request.
- **Operator approves**: the decision itself. Accept, Decline and Request material are a chief or managing editor's
  (`submissions.accept`, `submissions.decline`, `submissions.request_assets`); each shows the letter it sends first.
- **Moves on**: Accept to Accepted; Decline to Declined; Request material to Awaiting Assets.

## Awaiting Assets

- **Starts it**: Request material (from Under Review or Accepted), with the note of what is needed.
- **Owner**: the Editor.
- **Checks**: that the material arrived (an upload on the request, or a link the Editor can pull from, W9 item 4); the
  rights for anything new.
- **Email**: `awaiting_assets` to the submitter, with the note.
- **Matter decides**: whether what arrived answers the note (the Editor proposes Material received).
- **Operator approves**: Material received (`submissions.assets_received`).
- **Moves on**: Material received to Under Review (or straight to Accepted when it was accepted before); Withdraw ends it.

## Accepted

- **Starts it**: Accept (from Under Review or Awaiting Assets).
- **Owner**: the Editor for the write-up; the person who issues invoices for the money.
- **Checks**: the package and its price (Admin > Settings > products); that the address is good before the invoice goes.
- **Email**: `accepted` to the submitter.
- **Matter decides**: nothing about money; the Editor may propose the dossier fields of the property.
- **Operator approves**: the invoice (Admin > Invoices > New invoice, `payments.issue_invoice`).
- **Moves on**: Issue invoice to Invoice Issued; Request material to Awaiting Assets; Withdraw ends it.

## Declined

- **Starts it**: Decline from Under Review, with a reason from Admin > Automation > Decline reasons.
- **Owner**: none; the request is closed.
- **Email**: `declined` to the submitter, with the reason's paragraph and the note.
- **Moves on**: nothing; terminal.

## Invoice Issued

- **Starts it**: Issue invoice (from Accepted, or again after a void).
- **Owner**: the person who issues invoices.
- **Checks**: the invoice reached the address (the request page shows the email's delivery, W9 item 2).
- **Email**: `invoice` with the PDF attached.
- **Matter decides**: nothing; money is never a colleague's.
- **Operator approves**: Mark paid or Waive (`payments.mark_paid`, `payments.waive`), or Void.
- **Moves on**: once paid or waived, Activate (`submissions.activate`) creates the property and the request moves to
  Scheduled; a void lets a new invoice go; Withdraw ends it while nothing is paid.

## Scheduled

- **Starts it**: Activate, after payment (the gate refuses Scheduled while nothing is paid or waived).
- **Owner**: the Editor (the write-up, `PATCH /api/admin/properties/:id`, proposed and approved), with the photographs.
- **Checks**: the dossier is complete; the photographs are attached and their variants made; nothing illustrative.
- **Email**: none (`submission.activated` has no step).
- **Matter decides**: the write-up the Editor proposes.
- **Operator approves**: Publish (Admin > Properties > the property; never a colleague).
- **Moves on**: Publish to Published.

## Published

- **Starts it**: Publish, which emits `property.published` (catalog bump, cache purge, the visuals).
- **Owner**: the Social and Newsletter colleagues for distribution.
- **Checks**: the page renders; the visuals pass review.
- **Email**: the Campaign package's standalone email, approved before it goes.
- **Operator approves**: each visual (Admin > Visuals) and each post for the first 60 days.
- **Moves on**: the first post makes it Distribution Active; with no post ever, Completed.

## Distribution Active

- **Starts it**: the first post on a channel.
- **Owner**: the Social colleague.
- **Checks**: the posts and their numbers (Admin > Social posts).
- **Moves on**: Completed when the package's distribution is done.

## Completed

- **Starts it**: the end of the package.
- **Owner**: none; the report (Admin > Reports) is the last thing sent.
- **Moves on**: nothing; terminal.

## Withdrawn

- **Starts it**: Withdraw (`submissions.withdraw`, a managing editor or the admin, a person only) from Accepted, Awaiting
  Assets or Invoice Issued, with the reason; a due invoice is voided in the same call.
- **Owner**: none.
- **Email**: none.
- **Moves on**: nothing; terminal.

## The first case: Fairfield, California (request `4a3c2563-c07a-481d-839b-ad0523827f69`)

Submitted 2026-10-15 04:09 UTC by an agent for The Feature, rights confirmed, a listing link and no photography link.
Its confirmation bounced (Permanent) and the address is on the do-not-send list. By this sequence: the Editor's first
check (the address) fails, so it proposes a call, or a way to ask for the right address, as a note; a person corrects
the address and sends the confirmation again from the request page; then the Editor proposes Start review and Matter
decides it.
