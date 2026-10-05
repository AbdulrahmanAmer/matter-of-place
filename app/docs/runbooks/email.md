# Email

Transactional and notification email (slice B5). This page is written by step 3, the templates and their renderer. The
sending steps, the webhook and the Supabase Auth settings add their own sections when they are proven. The Resend
domains, the two sending identities and the key scope are recorded in `workspace/05-plans/ASSUMED.md` (E17, E18, H28,
H29) and are not repeated here.

## What is where

| Path                                            | What it holds                                                                                            |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `src/domain/email.ts`                           | The block model, the template keys, the send classes, the variables of each key and their sample values. |
| `src/templates/email/layout.tsx`                | The shell of every email: emblem, wordmark, one 600 px column, footer.                                   |
| `src/templates/email/blocks.tsx`                | The block model drawn as React Email components, and `Message`, the default `Email` of a template file.  |
| `src/templates/email/<key>.tsx`                 | One file per key: its `definition` (the seed) and its `Email` component.                                 |
| `src/templates/email/index.ts`                  | `definitions`, one entry per template file, and `definitionRow`.                                         |
| `src/server/email/render.ts`                    | `renderTemplate`: the one renderer that preview, test send and send share.                               |
| `src/server/email/variables.ts`                 | `resolveRecipient` and `resolveVariables`: who gets an email and what its variables say.                 |
| `src/server/email/context.ts`                   | `loadSiteContext` and `resolveAdminRecipients`.                                                          |
| `src/server/email/preview.ts`                   | `previewTemplate`: the stored row, drawn with an entity's variables or the samples.                      |
| `scripts/lib/email-lint.ts`                     | `lintEmail`, the HTML email lint.                                                                        |
| `scripts/email-test.ts`, `scripts/email-cpu.ts` | The render and send test, and the render timing.                                                         |

## What the code guarantees

- The stored row is what is sent. Subject, preheader and blocks come from the `email_templates` row; the template file
  of the row's key only draws them, and a row whose key has no template file is drawn in the plain shell (`Message`).
- Text and links take `{{variable}}` and nothing else. A name with no value is `missing_variable:<name>`, so nothing
  unreplaced is sent. A block whose text comes out empty is dropped, and so is a fact with no value.
- A link built from a variable must be https and on the site's own origin, or the render stops with `url_off_site`.
- The subject is one line whatever a variable held.
- `previewTemplate` answers a missing row with `AppError` `not_found` and a failed read of the row with `AppError`
  `unavailable`. A render or variable failure (`missing_variable:<name>`, `url_off_site`, `template_body_invalid`)
  escapes as a `NonRetryableError`, not an `AppError`: the route that calls it translates it. A preview of
  `interest_confirm`, `newsletter_confirm` or `repermission` with an entity stops at `missing_variable:confirm_url`,
  because `entityData` carries no `sealed_token`; preview those with the sample variables.
- The plain-text part is written from the resolved blocks, not converted from the HTML. In a scratch measurement made
  for this step on 2026-10-05 (laptop at 100 percent load from other lanes, production React build, 100 renders, p50), the
  React render took about 3.6 ms and `toPlainText` of `@react-email/render` about 7 ms. That script is not kept: UNPROVEN
  beyond that one run.

## Look at an email

```
cd app
bun run scripts/email-test.ts render received      # writes out/email-received.html
```

Open the file in a browser at 600 px. The emblem is `/apple-touch-icon.png` on the site origin the render is given, so it
shows only where that origin answers. On 2026-10-05 the dev Worker answered 200 for it and `matterofplace.com` did not
answer at all; to see the emblem now, point the file at the dev Worker with a text replace. `out/` is git-ignored.

Every key renders the same way (`render <key>`). The send mode, `all|<key> <address>`, is written and not yet run: it
needs the deployed job runner of step 4a. UNPROVEN until then.

## Add a template

1. Append the key to `emailTemplateKeys`, its variable names to `variablesByKey` and a sample for each new variable to
   `sampleValues` in `src/domain/email.ts`.
2. Write `src/templates/email/<key>.tsx` (copy a short one such as `inquiry-ack.tsx`), and append it to `definitions` in
   `index.ts`.
3. Add the resolver and the default recipient of the key to `src/server/email/variables.ts`.
4. Seed the row in a migration of the same commit, with its `class`. The definition must equal the seeded row.
5. Run `bunx vitest run tests/unit/email`. A template sent to a submitter also joins the `owner wording` case of
   `render.test.ts`. Add registry entries to `tests/mutations/<slice>.json` for any test you add.

## The lint

`lintEmail(html, text, key?)` returns a list of findings, each with a `rule`. The rules: `forbidden-tag`, `stylesheet`,
`img-alt`, `img-src`, `img-width`, `link-href`, `link-text`, `lang`, `title`, `container-width`, `size`, `table-role`,
`hex`, `placeholder-text`, `em-dash`, `preheader`, `text-empty`, `text-tags`, `text-url`. `tests/unit/email/lint.test.ts`
renders every definition with its sample variables and expects no finding, and has one crafted bad email for each rule.
Only the key `standalone` may carry Resend's `{{{RESEND_UNSUBSCRIBE_URL}}}`, and only `auth_magic_link` and
`auth_invite` may carry the Supabase Go-template link.

## Reading `email_messages`

```
cd app
bun run db:psql -- -c "select template_key, status, error, to_email, sent_at from email_messages order by created_at desc limit 20;"
```

`status` moves forward only: `sent`, `delivered`, then `bounced` or `complained`; `skipped` and `failed` are written by
the send step. The columns are those of `src/db/types.ts`; the query itself was not run by this step.

## Render cost

A Worker request has 10 ms of CPU on the free plan (P-009) and `previewTemplate` renders inside one, so
`bun run scripts/email-cpu.ts` renders every definition 50 times with its sample variables and prints the p95 per key
and overall. Above 8 ms overall it exits 1: the signal to make `previewTemplate` return the resolved blocks and let the
browser draw them with the same components. It is an in-process wall-clock timing, a proxy for Worker CPU, and it runs
React in its development build, which is slower than the production build the Worker bundles.

Measured on 2026-10-05 on the build laptop with its CPU at 100 percent from other lanes (`Win32_Processor`
`LoadPercentage` 100), three runs in a row, each exit 0: overall p95 **6.69**, **5.81** and **6.89 ms**. The third run,
per key (p95, ms): `received` 7.97, `declined` 5.00, `accepted` 3.41, `awaiting_assets` 3.56, `invoice` 7.71,
`inquiry_ack` 3.07, `inquiry_forward` 2.46, `interest_confirm` 3.09, `newsletter_confirm` 9.40, `admin_notify` 11.87,
`standalone` 7.92, `repermission` 9.09, `subject_ack` 4.36. A single key moved between 2 and 17 ms from run to run, so
only the overall figure is the gate. Three runs later the same day, with the load at 80 percent, printed overall p95
2.43, 2.30 and 2.91 ms. UNPROVEN as a Worker figure: no Worker has run this code yet (nothing in the Worker
imports `preview.ts` until B8b's preview endpoint does), so repeat the command on a quiet laptop and again from the
endpoint before relying on the margin.
