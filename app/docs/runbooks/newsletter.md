# Newsletter

Place Notes, the standalone emails and their audiences (slice B11). Step 2 writes this page: the Resend API as it is now,
and the tracking switch. The later steps add their own sections (audience ids, the mail classes, quotas, rescheduling and
unapproving) when they are proven. The Resend domains, the sending identities and the key scope are in
`workspace/05-plans/ASSUMED.md` (E17, E18, H28, H29) and are not repeated here.

Everything below was read from the Resend documentation (`resend.com/docs`, the pages of the API reference, the
dashboard guides and the Audiences to Segments migration guide) on 2026-10-07, and checked with read calls and a few
calls on the `mop-dev` account that were undone at once. The `context7` docs tool was not available in that session,
so the pages were fetched directly. Anything a sentence cannot show is marked UNPROVEN.

## What is where

| Path                                 | What it holds                                                                                      |
| ------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `src/server/channels/resend.ts`      | The only server file that calls the Resend audiences, contacts, broadcasts and tracking endpoints. |
| `src/server/email/resend-errors.ts`  | B5's `RESEND_ERRORS`: every Resend refusal is classified there, by error name first.               |
| `scripts/resend-tracking.ts`         | Sets or reads click and open tracking of the bulk sender's domain.                                 |
| `tests/unit/newsletter/send.test.ts` | The adapter against a fake provider.                                                               |

## What the API is now

- **Audiences are Segments.** In November 2025 Resend made contacts global and renamed Audiences to Segments. The
  Audiences API is marked deprecated and "will be removed in the future". On 2026-10-07 both `GET /audiences` and
  `GET /segments` still answered, with the same object and the same id, and `PATCH /audiences/{id}/contacts/{id}` still
  worked. The adapter calls only the Segments and Contacts endpoints. In our code an "audience" is a Resend segment and
  its id is a segment id.
- **Contact ids are global.** A contact is one record per email address, and sits in any number of segments. Removing it
  from a segment leaves the contact in the account; `GET /contacts/{id}` still answered after the removal. A contact
  deleted from the account was gone from the one segment it had been in (probed with one segment).
- **`unsubscribed` is global.** The flag is on the contact, not on the segment, and a contact that unsubscribed stays
  listed in its segments with `unsubscribed: true`.
- **`POST /contacts` on an address the account already holds marks it subscribed again.** A contact created
  with `unsubscribed: true` read `unsubscribed: false` after a second `POST /contacts`, with `unsubscribed: false` in the
  body and also with the field left out. Adding a contact to a segment through `POST /contacts/{id}/segments/{segment}`
  does not change the flag. The adapter's `addContact` therefore looks the address up first (`GET /contacts/{email}`)
  and only creates it when Resend answers 404; an existing contact is added to the segment and keeps its flag, and the
  answer says whether it is unsubscribed. `updateContact` is the one call that clears the flag.
- **Lists without `limit` return everything** in one answer (pagination guide), so `listContacts` makes one request. A
  list too large for one answer is UNPROVEN: the audiences are expected to stay small, and none held more than one test
  contact when this was written.

## Calls of the adapter

| Adapter call                           | Request                                                                                                                                                             | The plan's line (Audiences)            |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `ensureAudience(db, key)`              | `GET /segments`, then `POST /segments` `{ name }`                                                                                                                   | `POST /audiences`                      |
| `listContacts(audienceId)`             | `GET /segments/{id}/contacts`                                                                                                                                       | `GET /audiences/{id}/contacts`         |
| `addContact(audienceId, { email })`    | `GET /contacts/{email}`, then `POST /contacts/{id}/segments/{segment}` or, for a new address, `POST /contacts` `{ email, unsubscribed: false, segments: [{ id }] }` | `POST /audiences/{id}/contacts`        |
| `removeContact(audienceId, idOrEmail)` | `DELETE /contacts/{x}/segments/{segment}`, `GET /contacts/{x}/segments`, then `DELETE /contacts/{x}` when no segment is left                                        | `DELETE /audiences/{id}/contacts/{id}` |
| `deleteContact(idOrEmail)`             | `DELETE /contacts/{x}`                                                                                                                                              | `DELETE /contacts/{id}`                |
| `updateContact(id, { unsubscribed })`  | `PATCH /contacts/{id}`                                                                                                                                              | `PATCH /audiences/{id}/contacts/{id}`  |
| `createBroadcast(input)`               | `POST /broadcasts` with `segment_id`                                                                                                                                | `POST /broadcasts`                     |
| `sendBroadcast(id)`                    | `POST /broadcasts/{id}/send`                                                                                                                                        | the same                               |
| `getBroadcast(id)`                     | `GET /broadcasts/{id}`                                                                                                                                              | the same                               |
| `getDomainTracking()`                  | `GET /domains`                                                                                                                                                      | the same                               |
| `setDomainTracking({ click, open })`   | `GET /domains`, then `PATCH /domains/{id}` `{ click_tracking, open_tracking }`                                                                                      | the same                               |

Two signatures differ from the plan's list because of the global contact: `updateContact` takes no audience id, and
`removeContact` also deletes the contact when it is in no segment (forgetting, B3 GP-01), so `syncAudience` needs no
separate delete. `ensureAudience` adopts a segment of the right name that the account already holds before it creates
one, so a crash between the create and the stored id does not make a second segment. Audiences are named with the
prefix `dev-` unless `SITE_URL` is `https://matterofplace.com`.

Every call carries `Authorization: Bearer RESEND_API_KEY` and a `User-Agent`, and ends after 20 seconds. A 404 on a
removal answers `false` instead of failing. The errors:

| Answer                                                                                             | What the adapter throws                                  |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| 429 `rate_limit_exceeded`, `daily_quota_exceeded`, `monthly_quota_exceeded`, a locked resource     | `RateLimited` with `retryAt` from `RESEND_ERRORS`        |
| a named fatal error (`restricted_api_key`, `validation_error`, ...)                                | `NonRetryableError` with the name as message (`Invalid`) |
| any other 4xx                                                                                      | `Invalid` (`resend_<status>`), a `NonRetryableError`     |
| 404                                                                                                | `NotFound`, an `Invalid`                                 |
| 409 without a retry name, or `invalid_idempotent_request`                                          | `Conflict`                                               |
| `application_error`, a 5xx whose name is not in `RESEND_ERRORS`, a dropped connection or a timeout | `Transient`                                              |
| 503 `service_unavailable`                                                                          | `RateLimited` (`Retry-After`, at least 2 s)              |

Without live sends (`EMAIL_DRY_RUN=1`, or neither `MOP_ENV=production` nor `EMAIL_LIVE=1`) no call is made: ids are
`dry_<uuid>`, `listContacts` answers no contacts, `getBroadcast` answers a `draft`, `ensureAudience` writes nothing, and
the two tracking calls answer `null`. Without `RESEND_API_KEY` a live call throws `NonRetryableError("resend_not_configured")`.

## Broadcasts

- A broadcast is addressed with `segment_id`; the reference lists no `audience_id` for creating one any more, but a
  retrieved broadcast still carries both.
- `preview_text` is stored: a draft created with it answered it back on `GET /broadcasts/{id}`, although the create page
  of the reference does not list the field. The adapter sends the preheader there.
- `reply_to` takes a string; a retrieved broadcast returns it as a list.
- **`List-Unsubscribe` headers: UNPROVEN.** Neither the reference nor the guides say whether Resend adds them to a
  broadcast, and the create page lists no `headers` field. A draft created with `headers` was accepted, and the
  retrieved draft did not echo them. `createBroadcast` therefore passes `headers` when the caller gives them
  (the plan's rule when Resend is not recorded as adding them) and the footer must still carry
  `{{{RESEND_UNSUBSCRIBE_URL}}}`, which Resend replaces with a link to its unsubscribe page per recipient. Step 8 settles
  it by reading the headers of a received broadcast; until then do not count on a one-click header.
- A contact who unsubscribes through that page is unsubscribed from everything (the flag is global, and the reference
  says the page offers topics or everything). B5 expects Resend to post `contact.updated` with `unsubscribed: true` then;
  UNPROVEN until step 8 receives one.
- **The webhook's audience id: UNPROVEN.** The reference lists `audience_id` and `segment_ids` on `contact.updated`.
  B5's `apply_email_event` keeps a contact or broadcast event only when `audience_id` is one of
  `settings.resend.audiences`. For a global contact the value of `audience_id` may not be one of our segment ids; if it
  is not, every unsubscribe event is dropped with a 200 and `subscribers.unsubscribed_at` stays null. Step 8 reads the
  payload of a real unsubscribe; if the id is not ours, `apply_email_event` has to match on `segment_ids` too.
- Limits: 10 requests a second per team, answered with 429 and `Retry-After`; a broadcast sent with the contact quota
  exhausted is refused with 403 `validation_error`.

## Click tracking

- Tracking is a setting of a sending domain: `click_tracking` and `open_tracking` on `GET /domains` and on
  `PATCH /domains/{id}`. Both were `false` for all three domains on 2026-10-07.
- Place Notes sends from `notes.matterofplace.com` (ruling H29), so `scripts/resend-tracking.ts` sets the switches on
  that domain (`BULK_DOMAIN` in the adapter), not on `matterofplace.com` as the plan's line says. The reference sets
  tracking per domain, and broadcasts leave from `notes.`; that a switch on the root domain would not reach them is
  inferred, UNPROVEN. Transactional mail leaves from `notify.`, which this script does not touch, so a confirm link is
  not rewritten.
- The reference says the two switches "only apply if a `tracking_subdomain` is configured and verified". The detail of
  `notes.matterofplace.com` carried none on 2026-10-07. UNPROVEN: whether `PATCH` without a subdomain is refused or only
  stored. The tracking subdomain is a CNAME record that has to be added at Cloudflare and verified before the
  real-domain run; none has been added.
- Clicks drive `last_engaged_at` (B5) and the per-property metrics. Opens stay off (invariant 8).

```
cd app
bun run scripts/resend-tracking.ts            # sets click on, open off, prints "click_tracking on open_tracking off"
bun run scripts/resend-tracking.ts --check    # reads and prints the two values only
```

The command reads `RESEND_API_KEY` from the shell or from the root `.env`, never prints it, and exits 1 on any refusal.
It counts as a live call, so `EMAIL_DRY_RUN=1` stops it. The real-domain run waits for step 8; its proof is the two
values printed and then `select last_engaged_at from subscribers where email = '<test>'` set after one test click.

## Probe objects

The checks of 2026-10-07 created and deleted on `mop-dev`: three contacts (`b11-probe@`, `b11-probe2@` and
`b11-probe3@resend.dev`), one broadcast draft in the `General` segment and a segment named `dev-b11-probe`. Afterwards `GET /contacts` and
`GET /broadcasts` answered empty lists and `GET /segments` only `General`.
