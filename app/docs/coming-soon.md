# Coming-soon mode

Production shows no illustrative property, ever. Every empty collection becomes a per-market interest signup. This page is the runbook for the mode and the reviewed design decisions behind it (B3b step 1, mop-designer). The code it describes arrives in steps 2 to 10 of the slice; until a step lands, its paragraph here is the contract.

## How the mode works

Three independent layers keep an illustrative property off production.

1. `markets.coming_soon` is true for California, New York and Florida until a market opens. It is the fail-safe: the default is true.
2. `settings.coming_soon_global` forces every collection empty whatever the markets say. Default false. It is how a designer or the operator sees the empty state on a database that holds the seed.
3. `settings.environment` marks the one database. Once it is `production`, a trigger refuses an `Illustrative` property and the public catalog also hides any such row.

A market opens when its first property is published (the `property.published` recipe, B8b) or when the chief editor or the managing editor turns the market switch off (`/admin/markets`). Opening bumps `catalog_version`, so the pages change within the 15 second state memo, not after the 5 minute edge cache.

While a market is coming soon, its photographs, the region photographs and the market guide hero are not rendered (CEO override S43). The pages are type on Bone and Ivory.

## Feature flags

Flags are data in the `settings` row `flags`. They are read in one place: `getFlags(db)` in `src/server/lib/flags.ts`, which takes them from the public state and has no query or memo of its own. The browser never receives the bag, only its effects.

- `new_channels` and `archive_pages` are the stored flags, both false by default.
- `coming_soon` is derived: `mergeFlags` adds it from `coming_soon_global`. It is never stored in the row.

To add a flag, add its key to `featureFlags` in `src/domain/flags.ts` and its default, false, to `defaultFlags` in the same file; the `Record` type refuses a flag without a default. Read it only through `getFlags`. No migration is needed, the `/admin/settings` editor (B7 screen 24, B8b editor) lists the same array, and unknown keys in the row are ignored. Flipping a flag in production needs no deploy.

## Consent record

Google Analytics (gtag.js only) loads only when the stored record allows it. The record is client side:

- `localStorage` key `mop_consent`, value `{ "version": 1, "analytics": true, "decided_at": "<ISO time>" }`.
- `consentGranted()` is true only when `version` equals `CONSENT_VERSION`, `analytics` is true and the browser does not send Global Privacy Control. Global Privacy Control counts as declined and nobody is asked.
- To make every visitor decide again, raise `CONSENT_VERSION` in `src/lib/consent.ts`. If the notice text changes in substance, or a second analytics vendor is added, raise it in the same commit.
- To see the notice again in your own browser, delete the `mop_consent` key or press the footer's `Cookie settings` button.
- First-party `track()` events are anonymous and exempt: they keep counting whatever the visitor chose.

## Who flips what

- `markets.coming_soon`: the chief editor or the managing editor (permission `markets.edit`, B7) in `/admin/markets` (screen 15), or the publish recipe when a market's first property goes out.
- `settings.coming_soon_global`: an admin only, with a recent sign-in, in `/admin/settings` (screen 24).
- Feature flags: an admin only, in the flags editor on `/admin/settings` (screen 24).
- `settings.environment`: nobody by hand. `bun run set-env -- --target dev --value production` is the last act of the launch switch and cannot be undone by the same script.

## See the empty state on preview or locally

The local adapter serves the bundled illustrative data, so it cannot show an empty state. No local database exists (S50). Run the app in live mode against `mop-dev` with the global switch on.

- In the browser: `/admin/settings`, `coming_soon_global` on. Turn it off when you finish.
- From the laptop, before the launch switch only: `bun scripts/with-coming-soon.ts --value true -- <command>`. It takes the advisory lock `mop-dev-tests`, sets `coming_soon_global`, runs the command and restores the value it read, so it cannot collide with a committed test run on the same database (G34). It is the one way this slice flips the value from the laptop; do not run a bare `update` through `db:psql`, which takes no lock and has no production check.
- After the launch switch `with-coming-soon.ts` refuses (`refusing: production database`), as does every destructive or test command. Preview Workers then build with the local adapter and show the bundled seed.

## Launch checklist

The launch switch is L1 step 1, letters 1b to 1g, run once from `main` in letter order (ruling H35 (4); `workspace/05-plans/L1.md` holds the full text). This page names the parts that touch coming-soon mode.

1. 1b: the previews lose the database pair, then the last `bun run db:reset` empties the database. 1c and 1d push the launch auth values and the job runner secrets.
2. 1e: B2's production seed, `bun run seed -- --target dev --mode reference --images upload` (markets, regions, notes and guide, all editorial, none illustrative). The `upload` mode needs B9's media store and refuses until B9 has landed.
3. 1f: the first admin user.
4. 1g: `bun run set-env -- --target dev --value production`, then `gh variable set MOP_DB_PRODUCTION --body true`. Without the variable the deploy-time assertion below is skipped, silently.
5. `deploy.yml` then runs `node scripts/assert-coming-soon.mjs https://matter-of-place.holy-meadow-4327.workers.dev` after every production deploy, only while `vars.MOP_DB_PRODUCTION` is `true`. It exits 0 only when the properties list is empty, all three markets are coming soon, and no page carries `ILLUSTRATIVE` or a property card. A failure fails the job after the deploy; the remedy is `bunx wrangler rollback`, not a retry. Run it by hand the same way for a first proof.
6. L1 step 4e attaches the domain and sets `gh variable set MOP_LAUNCHED --body true`. From then on `deploy.yml` adds `--after-launch`, which runs one check, that neither `/` nor `/properties` carries `ILLUSTRATIVE`, because a published property and an open market are then expected (L1 step 7).

## Design decisions

### Composition

- Dominant: type. The market name, one calm statement and the signup, set large in Cormorant Garamond on Ivory, with Jost for the eyebrow, labels and buttons.
- Recedes: everything that is not a sentence. No photograph, no card, no icon, no box. One hairline in `--border` above the block.
- Moves: nothing new. The existing soft text entry runs once and `prefers-reduced-motion` turns it off. The consent notice does not animate at all.

### The `ComingSoon` block

One component in three scopes: home, collection pages (properties, stories) and market or region pages. It is a `section` named by its heading (`aria-labelledby`). It sets vertical padding only; the section wrap owns width.

- Desktop (1440): the existing `editorial-statement` grid. The eyebrow sits left. The right column holds the `h2`, one paragraph, then the form on a single row (field, button) with the market chooser beneath as three checkboxes in a row.
- Phone (390): one column. Field, then the three chooser rows at full width, then the button. Every target is 44 px high.
- No card, no illustration, no border box. Small print (`form.note`) uses `--muted-foreground`, not Warm Grey, which is too pale on Ivory at that size.

### Home

- The hero image section becomes a text hero: the `h1` from `siteConfig.tagline`, then `what` as a Cormorant lede. This is the only `h1` on the page.
- Under it, `ComingSoon` with `home.title` as its `h2`, `home.text` and the form with all three markets offered. `eyebrow` is shown once, in that block.
- "Selected properties" is replaced by nothing. The three market cards stay, carry the `badge` and the `cardLine` in place of the region list, and show no photograph.

### Market and region pages

- Intro, notes, guide link and the region list stay as type. The property collection, the filter bar and the "recent" rows give way to `ComingSoon`.
- The market chooser is hidden and the market is preselected. A region page names the region in its title and the market in its text.
- The market guide page renders no hero image while the market is coming soon.

### Illustrative wording

`illustrative.*` renders only when the catalog says illustrative content is allowed (development and preview). `IllustrativeNotice` is one block (`label`, `title`, `text`, `link`). It renders wherever the page holds a property whose status is `Illustrative`, and nothing otherwise: under the hero on home, and on the properties, market, region and property pages. Cards and heroes carry a separate, smaller tag, `ILLUSTRATIVE PROPERTY`, only on an `Illustrative` property; it is not part of the copy table. Production never renders any of it. Stories carry no illustrative wording at all (G70), and the stories page drops its intro line "Sample stories, shown to set the format."

### Consent notice

- A single row at the top of the footer, in the page flow, never `position: fixed`, so it cannot cover the sticky property bar or the concierge button. It is separated from the footer links by one hairline in `--border`. No card, no box, no dialog.
- Desktop (1440): the sentence with the privacy link on the left, two buttons on the right. `Allow` is the filled button. `No, thank you` is a text button of the same height and the same reach, so declining costs the same as accepting.
- Phone (390): the sentence, then the two buttons as full-width rows with 44 px targets, then the link.
- After a choice the row collapses. The footer then shows `Cookie settings` as a quiet text button that reopens it.

## Copy

Final strings for `t.comingSoon` in `src/lib/strings.ts`. `{market}`, `{region}` and `{intro}` are filled at render. No em dash, no exclamation mark, no hyperbole, no promise of a result. The form also reuses `t.common.emailAddress`, `t.common.sending`, `t.forms.error` and `t.forms.invalid`.

| Key                  | String                                                                                                                                                    |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `eyebrow`            | OPENING SOON                                                                                                                                              |
| `what`               | Matter of Place is an editorial publication for exceptional existing residential property in California, New York and Florida.                            |
| `home.title`         | The first properties are being considered.                                                                                                                |
| `home.text`          | We publish only what we have reviewed and accepted. Nothing is listed yet. Leave your email and we will write when the first property is published.       |
| `properties.title`   | No property is listed yet.                                                                                                                                |
| `properties.text`    | Every property here will have been reviewed and accepted by our editors. Tell us where you are looking and we will write when the first one is published. |
| `market.title`       | No property is listed in {market} yet.                                                                                                                    |
| `market.text`        | The {market} desk is reading the market and reviewing what agents send us. We will write when the first {market} property is published.                   |
| `region.title`       | No property is listed in {region} yet.                                                                                                                    |
| `region.text`        | The first {market} properties will appear here and on the {market} page. Leave your email and we will write when they do.                                 |
| `stories.title`      | Stories arrive with the first properties.                                                                                                                 |
| `stories.text`       | We write about a place once we have properly considered it. Leave your email and we will write when the first story is published.                         |
| `form.legend`        | Where are you looking?                                                                                                                                    |
| `form.submit`        | Tell me when it opens                                                                                                                                     |
| `form.note`          | We will only write about this.                                                                                                                            |
| `form.sentMarket`    | Thank you. We will write when the first {market} property is published.                                                                                   |
| `form.sentAny`       | Thank you. We will write when the first property is published.                                                                                            |
| `badge`              | Opening soon                                                                                                                                              |
| `cardLine`           | No property listed yet                                                                                                                                    |
| `meta.properties`    | No property is listed yet. Leave your email to hear when the first one is published.                                                                      |
| `meta.market`        | {intro} No property is listed in {market} yet.                                                                                                            |
| `illustrative.title` | What is real here                                                                                                                                         |
| `illustrative.text`  | The properties shown on this site are illustrative. They show how a dossier reads. None is for sale through Matter of Place and none is a real listing.   |
| `illustrative.link`  | Read our editorial standard                                                                                                                               |
| `illustrative.label` | ILLUSTRATIVE PREVIEW                                                                                                                                      |
| `consent.label`      | Cookie notice                                                                                                                                             |
| `consent.text`       | We would like to count which pages are read, using Google Analytics. It sets cookies. If you say no, nothing else changes.                                |
| `consent.accept`     | Allow                                                                                                                                                     |
| `consent.decline`    | No, thank you                                                                                                                                             |
| `consent.link`       | Read our privacy policy                                                                                                                                   |
| `consent.change`     | Cookie settings                                                                                                                                           |

`consent.link` points at the privacy text that exists today, `<Link to="/legal" hash="privacy">`, the same target as the footer's Privacy link. B16 creates `/privacy` and moves the footer link; it changes this link in the same commit. After B5 adds double opt-in, `form.sentMarket` and `form.sentAny` gain "Please confirm from the email we send." (B5 changes the two strings.) The stories page keeps its `PageIntro` line `Original writing from three editorial desks.`

Where each string appears: `eyebrow`, `*.title`, `*.text` and the `form.*` strings in `ComingSoon`; `what` in the home hero only; `badge` and `cardLine` on the market card; `meta.*` in the page description; `illustrative.*` as set out above; `consent.*` in the footer notice.

## Accessible names and focus

### ComingSoon and its form

- The section is named by its heading. On home the heading is the `h1` and `home.title` is the `h2`; elsewhere `title` is the `h2` and the page already holds its own `h1`. One `h1` per page.
- The email field has a visible label from `t.common.emailAddress`, never a placeholder alone, and `autocomplete="email"`.
- The chooser is a `fieldset` whose `legend` is `form.legend`. Each market is a checkbox with its market name as the label. Choosing none is allowed and sends the interest for any market (`form.sentAny`).
- The honeypot field is hidden from assistive technology and skipped by Tab.
- The result lives in one `role="status"` region that is in the page before the first submit, so the confirmation is announced. A failure is `role="alert"`, sets `aria-invalid` on the field and is linked with `aria-describedby`.
- Reading order is heading, field, chooser, button, as the plan states. On desktop the button sits on the field's row, so Tab moves from the field down to the chooser and back up to the button. Choosing a market is optional, so nothing depends on it, but this is the one place the visual and the tab order differ. Flagged for the review below.
- The busy state disables the button only. The field keeps its value and its focus. After an error, focus returns to the field. After success the form stays mounted, the field is cleared and keeps focus, and the status region announces the confirmation.
- The `form.note` line is linked to the button with `aria-describedby`.
- Targets are at least 44 px high on phone and desktop. Text is `--foreground` or `--muted-foreground` on Ivory or Bone, both above 4.5:1.

### Consent notice

- A `div` with `role="region"` and `aria-label` set from `consent.label` ("Cookie notice"). Not a dialog, no `aria-modal`, no focus trap, no autofocus.
- It takes no focus on load and announces nothing on load.
- The two buttons are native `button` elements whose accessible names are their visible text (`Allow`, `No, thank you`). The privacy link is a real link.
- DOM order is the sentence, `Allow`, `No, thank you`, then the link, which is the phone order. On desktop the link is set under the sentence on the left, so Tab runs Allow, No thank you, then back to the link. A one-line bend, taken to keep a single DOM for both widths.
- Closing by keyboard moves focus to the footer's `Cookie settings` button (`id="consent-change"`). Closing by pointer removes the clicked button with the row, so the browser returns focus to the page; nothing is announced and no ring shows. Step 5's consent spec records where focus lands, and this line changes if it does not hold.
- Pressing `Cookie settings` reopens the row and moves focus to the region (`tabindex="-1"`), so a keyboard user hears its name and reaches `Allow` with the next Tab. This is user initiated, not on load.
- The focus ring is the site's `:focus-visible` outline in `--foreground`.

## Review notes

Bent, and why:

- Desktop tab order in the form and in the notice differs from the visual order in one place each (named above). Both keep one DOM for two widths. Reviewer to confirm, or ask for a desktop-only reorder.
- `what` appears on the home hero only. The plan names the string without a place; one appearance keeps the statement from repeating on every page.

Checked against the brand: palette tokens only, no gradient, no shadow, no card, no photograph, no motion beyond the existing soft entry. Copy has no em dash, no promise of leads, buyers or sales, and names only California, New York and Florida.
