# B3b — Coming-soon mode


> **CEO override 2026-09-30 (S43):** coming-soon pages show NO illustrative photographs. Type only on Bone/Ivory: market name, the coming-soon statement, the interest signup. Hide market and region images while `coming_soon` is true. Any step below that keeps photographs on production is superseded.
Lane: Foundation · Stage: 3 BUILD · Owner agent: mop-designer for step 1 (layout decisions and copy, no HTML wireframes, S41), then mop-builder for steps 2 to 10 · Depends on: B2 (`markets.coming_soon`, `settings`, `subscribers.markets`, seed), B3 (live catalog, `visibility.ts` pass-through, `subscriberSchema.markets`, `Market.comingSoon`, `analyticsEvents`) · Unblocks: B4 (coming-soon e2e project), B5 (market-interest confirmation copy), B7 (screen 15 toggle and interest count, screen 24 global switch), B13 (SEO for empty pages), Stage 5 launch

Landing order for batch A: B3b starts after B3 step 5 (steps 1 to 3 need only the contract) and finishes after B3 step 12.

## Goal and observed exit
Production shows no illustrative property, ever, and every empty collection turns into a per-market interest signup (S30; architecture 10; tech-stack 1 "Launch mode").
Observed exit (completion map B3b): production shows zero listings and a signup; preview shows the seed. Proved by (1) the database refusing an illustrative row once a project is marked production, (2) the public API returning none, (3) a Playwright project that loads every empty state on a reference-only database and submits the signup, and (4) `scripts/assert-coming-soon.mjs` run by the production deploy.

## Contract (inputs, outputs, invariants, events emitted, permissions)
Inputs
- `markets.coming_soon` (default true), `markets.interest_copy`, `settings.coming_soon_global`, `settings.environment` (`development | preview | production`, default `development`), `subscribers.markets text[]`, `properties.status` (`Illustrative` for every seeded property).
- `Market.comingSoon: boolean` and `interestCopy?: string` in the API payload (mapped by B3: `comingSoon = coming_soon_global OR markets.coming_soon`).

Outputs
- Empty states on `/`, `/properties`, `/stories`, `/$market`, `/$market/$region`, and the "Opening soon" badge on market cards (`/markets`, home).
- `InterestForm`: one email field, the market preselected on market and region pages, a three-market chooser elsewhere, writing `subscribers.markets` through the existing `POST /api/public/subscribers`.
- `IllustrativeNotice`: the viewer statement, shown wherever an illustrative property is on the page, never in production.
- The database guard, the automatic market opening, and the interest counts view (used by B7).

Rules
1. A market is open when `comingSoon` is false. A collection is empty when it has no visible property. The empty state renders when a collection is empty, whatever the flag says (a market flipped open by mistake still shows the honest empty state).
2. Effective coming-soon for a market is `settings.coming_soon_global OR markets.coming_soon`. The global flag is the kill switch and is edited in `/admin/settings` (screen 24); the per-market flag in `/admin/markets` (screen 15).
3. The API hides properties of a coming-soon market from lists and returns 404 for their detail routes. In production it also hides `status = 'Illustrative'` rows (defence in depth: the database already refuses them).
4. First publication opens the market. When a property becomes `published` and its market is still `coming_soon`, a trigger sets `coming_soon = false` and writes an `audit_log` row. ASSUMED deviation from architecture 10, which names the `property.published` recipe: the step catalog is fixed at 14 types (S34) and a database trigger gives the same result without a fifteenth step, and it runs even if the recipe is switched off. System writes to `audit_log` use `actor_id = null`, `actor_kind = 'agent'`, `note = 'system'` (ASSUMED; B7 shows them as "System").
5. Stories are editorial writing and stay visible whether or not a market is open. Seeded stories exist only in development and preview (B2), so production shows none until real ones are published, and the stories page then shows its empty state.
6. Submissions stay open in coming-soon mode; the "Submit a Property" calls to action are unchanged.
7. Interest signups are separate consent from Place Notes. ASSUMED: a subscriber whose `source` starts with `interest:` receives only the market-opening mail until they also sign up through a Place Notes form (`source` without that prefix). B5 words the confirmation mail accordingly and B11 filters the audience; this rule is recorded here so neither is surprised.

Invariants
1. Production (`settings.environment = 'production'`) cannot contain an `Illustrative` property: a trigger raises on insert or update, and `set_environment('production')` refuses while one exists.
2. `scripts/seed.ts --mode full` refuses to run against a project whose `settings.environment` is `production` (B2 guard, tested here).
3. Copy follows the brand rules: calm, brief, specific, no em dashes, no hyperbole, no guarantee of leads, buyers or sales, markets California, New York and Florida only. A Vitest scan enforces the mechanical parts.
4. Sections set vertical padding only; `.section-wrap` owns width (G-007). No hex in CSS; new spacing or colour goes into `tokens.css` first.
5. Every user action calls `track()` with a name from `analyticsEvents`: `interest_signup` and `coming_soon_view` (new).
6. One `h1` per page. Empty states use `h2`; the home empty hero supplies the home `h1`.

Events emitted: none new. `subscriber.confirmed` (B3, after the confirmation click, B5 mail) is unchanged. Permissions: public. The toggles are admin-only server functions in B7 (`chief_editor`, `managing_editor` for a market, `admin` for the global switch).

### Copy (final strings; `t.comingSoon` in `src/lib/strings.ts`; `{market}` and `{region}` are filled by `fill()`)
| Key | String |
|---|---|
| `eyebrow` | `OPENING SOON` |
| `what` | Matter of Place is an editorial publication for exceptional existing residential property in California, New York and Florida. |
| `home.title` | The first properties are being considered. |
| `home.text` | We publish only what we have reviewed and accepted. Nothing is listed yet. Leave your email and we will write when the first property is published. |
| `properties.title` | No property is listed yet. |
| `properties.text` | Every property here will have been reviewed and accepted by our editors. Tell us where you are looking and we will write when the first one is published. |
| `market.title` | No property is listed in {market} yet. |
| `market.text` | The {market} desk is reading the market and reviewing what agents send us. We will write when the first {market} property is published. |
| `region.title` | No property is listed in {region} yet. |
| `region.text` | The first {market} properties will appear here and on the {market} page. Leave your email and we will write when they do. |
| `stories.title` | Stories arrive with the first properties. |
| `stories.text` | We write about a place once we have properly considered it. Leave your email and we will write when the first story is published. |
| `form.legend` | Where are you looking? |
| `form.submit` | Tell me when it opens |
| `form.note` | We will only write about this. |
| `form.sentMarket` | Thank you. We will write when the first {market} property is published. |
| `form.sentAny` | Thank you. We will write when the first property is published. |
| `badge` | Opening soon |
| `cardLine` | No property listed yet |
| `meta.properties` | No property is listed yet. Leave your email to hear when the first one is published. |
| `meta.market` | {intro} No property is listed in {market} yet. |
| `illustrative.title` | What is real here |
| `illustrative.text` | The properties shown on this site are illustrative. They show how a dossier reads. None is for sale through Matter of Place and none is a real listing. |
| `illustrative.link` | Read our editorial standard |
| `illustrative.label` | ILLUSTRATIVE PREVIEW |
The form reuses `t.common.emailAddress`, `t.common.sending`, `t.forms.error` and `t.forms.invalid` for its field label, busy state and failures. `stories.index.tsx` keeps its existing intro line ("Sample stories, shown to set the format.") only when stories exist. After B5 adds double opt-in, `form.sentMarket` and `form.sentAny` gain "Please confirm from the email we send." (B5 changes the two strings).

### Layout decisions (mop-designer; no wireframes)
- One shared block, `ComingSoon`, in three scopes. Desktop (1440): the existing `editorial-statement` grid, eyebrow left, right column holds `h2`, one paragraph, then the form on a single row (field, button) with the market chooser beneath as three checkboxes in a row. Phone (390): one column, form stacked, chooser as three full-width rows with 44 px targets.
- No card, no illustration, no border box (brand: no SaaS cards). A single hairline above the block using `--border`.
- Home: when no visible property, the hero image section is replaced by a text hero (`h1` "Exceptional property. Properly considered." from `siteConfig.tagline`, then `home.text` and the three-market form); the "Selected properties" section is replaced by nothing; the three market cards stay and carry the "Opening soon" badge.
- Market and region pages keep their editorial content (intro, notes, guide link, region list). The property collection, filter bar and "recent" rows are replaced by `ComingSoon`; the market chooser is hidden and the market preselected.
- Focus order: heading, field, chooser, button. The busy state disables the button only; the field keeps focus.

## Files (create / change; one line each: path — what it contains)
Create (under `Matter Of Place Codebase/`)
- `supabase/migrations/20261001110000_coming_soon.sql` — `refuse_illustrative_in_production()` trigger on `properties` (before insert or update; raises when `status = 'Illustrative'` and `settings.environment = 'production'`); `set_environment(p_value text)` (`security definer`, service role only, refuses `production` while an illustrative property exists, writes `audit_log`); `open_market_on_publish()` trigger (after insert or update on `properties`, sets `markets.coming_soon = false` and writes `audit_log`); view `market_interest_counts` (`market_slug`, `total`, `confirmed`, `security_invoker = on`, built from `unnest(subscribers.markets)`).
- `src/lib/coming-soon.ts` — pure helpers: `isComingSoon(market)`, `openMarkets(markets)`, `hasListings(properties)`, `interestSource(scope)` (`interest:home`, `interest:properties`, `interest:stories`, `interest:<market>`, `interest:<market>/<region>`).
- `src/components/site/coming-soon.tsx` — `ComingSoon({ scope, market?, region? })`: eyebrow, `h2`, text, `InterestForm`, fires `coming_soon_view` once.
- `src/components/forms/interest-form.tsx` — email, market preselected or chooser (checkboxes in a `fieldset` with a `legend`), `useAsyncAction`, `subscriberSchema.parse({ email, source, markets })`, `track("interest_signup", { markets })`, `FormError`, success text by market.
- `src/components/site/illustrative-notice.tsx` — `IllustrativeNotice({ properties })`: returns null unless one property has `status === "Illustrative"`; label, title, text, link.
- `src/styles/components/coming-soon.css` — layout above, tokens only, imported from `src/styles.css`; a `tokens.css` addition only if a new spacing step is needed.
- `scripts/set-environment.ts` — `bun run set-env -- --target dev|prod --value development|preview|production` calling `set_environment` with the matching service key.
- `scripts/assert-coming-soon.mjs` — `node scripts/assert-coming-soon.mjs <baseUrl>`: `GET /api/public/properties` is `[]`, `GET /api/public/markets` has three markets and every `comingSoon` is true, `/` and `/properties` HTML contain neither `ILLUSTRATIVE` nor a property card, `/california` HTML contains the `market.title` sentence for California. Exits non-zero otherwise. The `markets` check is skipped with `--after-launch`, which keeps only the "no illustrative" assertions.
- `docs/coming-soon.md` — how the mode works, who flips what, how to see the empty state on preview (set `coming_soon_global` in `/admin/settings`, or run `bun run seed -- --target local --mode reference`), the launch checklist (`set_environment('production')`, reference seed, assert script).
- Tests: `tests/unit/coming-soon.test.ts`, `tests/unit/visibility.test.ts`, `tests/unit/copy-voice.test.ts`, `tests/unit/interest-form.test.tsx` (jsdom project from B4); `tests/db/illustrative-guard.db.test.ts`, `tests/db/open-market.db.test.ts`, `tests/db/interest-counts.db.test.ts`; `tests/api/coming-soon.api.test.ts`; `tests/e2e/coming-soon.spec.ts`.
Change
- `src/server/catalog/visibility.ts` — implement `applyVisibility` (B3 ships the pass-through): drop properties of a coming-soon market, drop `Illustrative` rows when `MOP_ENV = production`; the same function marks `comingSoon` on each market.
- `src/lib/strings.ts` — add `comingSoon` (table above) and a `fill(template, values)` helper.
- `src/lib/analytics.ts` — add `interest_signup` and `coming_soon_view` to `analyticsEvents`.
- `src/components/site/market-card.tsx` — badge `t.comingSoon.badge` and the line `t.comingSoon.cardLine` instead of the region list when `market.comingSoon`.
- `src/routes/index.tsx` — text hero and `ComingSoon scope="home"` when `hero` is empty; skip the featured grid when `featured` is empty; `IllustrativeNotice` under the hero.
- `src/routes/properties.tsx` — `ComingSoon scope="properties"` and no `HomeFinder` or filter bar when the list is empty; `noindex` in `pageHead` while empty (ASSUMED, thin page); `IllustrativeNotice`.
- `src/routes/$market.index.tsx`, `src/routes/$market.$region.tsx` — empty pool renders `ComingSoon` with the market (and region) and no filter bar; `pageHead` description from `meta.market`; `IllustrativeNotice`.
- `src/routes/markets.index.tsx` — no code change beyond the card badge; verified by the e2e.
- `src/routes/stories.index.tsx` — `ComingSoon scope="stories"` when the list is empty, otherwise unchanged.
- `src/routes/property.$slug.tsx` — `IllustrativeNotice` only.
- `src/styles.css` — one `@import` for `coming-soon.css`.
- `.github/workflows/deploy.yml` — production job runs `node scripts/assert-coming-soon.mjs` after the smoke test (B1b file, one appended step).
- `package.json` — scripts `set-env`, `test:e2e:coming-soon` (reset, seed `reference`, run the Playwright `coming-soon` project; wired by B4).

## Data changes (migrations, enums, RLS, seeds)
- Migration `20261001110000_coming_soon.sql` as above. No new enum, no new table. RLS: the view runs with the caller's rights (`security_invoker`), so only staff roles with `select` on `subscribers` can read it; the functions are `execute` for the service role only.
- Seeds: no new seed file. `scripts/seed.ts --mode reference` (B2) is the production seed for markets, regions, notes and guide (all editorial, none illustrative); `--mode full` is development and preview only. Production runs `set_environment('production')` after the reference seed and before the first deploy that reads real data.
- `settings.environment` is per Supabase project: `mop-dev` stays `development` (preview reads it, so preview can hold illustrative rows), `mop-prod` becomes `production`.

## Steps (ordered; each fits half a day; each ends with the command that proves it)
1. Design decisions and copy accepted (mop-designer). Deliver the layout decisions and the copy table above as a reviewed section in `docs/coming-soon.md`, plus the accessible-name and focus notes. Proof: `bunx vitest run tests/unit/copy-voice.test.ts` (the scan passes on the final strings: no em dash, no `!`, none of `exclusive`, `guarantee`, `stunning`, `luxury`, `buyers`, `leads`, `unlock`, and only the three market names appear).
2. Strings, helpers, analytics names. Proof: `bunx vitest run tests/unit/coming-soon.test.ts tests/unit/copy-voice.test.ts` and `bun run check`.
3. Migration and guards. Proof: `bun run db:reset && bunx vitest run --project db tests/db/illustrative-guard.db.test.ts tests/db/open-market.db.test.ts tests/db/interest-counts.db.test.ts`: an illustrative insert succeeds in `development`, `set_environment('production')` then fails while it exists, succeeds once it is deleted, a new illustrative insert then raises; publishing the first property of a coming-soon market sets `coming_soon = false` and leaves one `audit_log` row; a second property adds no row; the view counts one signup for `california` and one for `california` plus `florida` as 2 and 1.
4. `visibility.ts`. Proof: `bunx vitest run tests/unit/visibility.test.ts tests/api/coming-soon.api.test.ts --project db`: global flag on gives `/properties` `[]`, `/markets` all `comingSoon: true` and the detail route 404; `MOP_ENV=production` hides an illustrative row even when one is planted directly (planted before the guard is switched on); a preview/`development` environment shows them.
5. `InterestForm` and `ComingSoon` with CSS. Proof: `bunx vitest run tests/unit/interest-form.test.tsx` (market prop sends `markets: ["california"]`, chooser sends the chosen set, empty chooser with no market disables the button, `source` is `interest:california`), then `bun run dev` with the reference seed and `VITE_API_BASE_URL=/api/public`, screenshot `/` at 1440 and 390 and read them.
6. Route changes and market card badge. Proof: `bun run check` and `bun run build`; the e2e in step 8 will assert them, and `curl -s http://127.0.0.1:8788/california | grep -c "No property is listed in California yet."` prints 1 on the built Worker with the reference seed.
7. `IllustrativeNotice` and the preview path. Proof: with the full seed, `curl -s http://127.0.0.1:8788/ | grep -c "What is real here"` prints 1; with `MOP_ENV=production` and the reference seed it prints 0.
8. Playwright `coming-soon` project. Proof: `bun run test:e2e:coming-soon` passes: home has no hero image and no property card, shows three market cards with the badge, `/properties` shows its title and no filter bar, `/california`, `/california/bay-area` and `/stories` show their empty states with the form, submitting `test+<n>@example.com` on `/california` creates one `subscribers` row with `markets = {california}` and `source = interest:california`, `/property/anything` is the 404 page, axe reports nothing serious or critical at 1440 and 390, no horizontal overflow.
9. Deploy assertion and runbook. Proof: `node scripts/assert-coming-soon.mjs http://127.0.0.1:8788` exits 0 on a reference-only database with `MOP_ENV=production`, and exits 1 (naming the failing check) after `bun run seed -- --target local --mode full` with `MOP_ENV=local` (the assert script is meant for production; this proves it can fail). `docs/coming-soon.md` launch checklist reviewed.
10. Close-out. Update B1b's `deploy.yml` call, remove any temporary flags, note the `interest:` audience rule in `docs/coming-soon.md` for B5 and B11. Proof: `bun run check`, `bun run build`, and `grep -rn "#[0-9a-fA-F]\{6\}" src/styles/components/coming-soon.css` prints nothing (G-007).

## Verification (commands and expected output; watched-fail for every new test)
- In `Matter Of Place Codebase`: `bun run check` and `bun run build` exit 0. `bunx vitest run tests/unit` and `bunx vitest run --project db tests/db tests/api` pass. `bun run test:e2e:coming-soon` passes.
- Watched-fail, each done once and reverted (`scripts/watchfail.mjs`): (a) delete the production branch in `visibility.ts`, `visibility.test.ts` must go red; (b) drop the `refuse_illustrative_in_production` trigger in a scratch migration, `illustrative-guard.db.test.ts` must go red; (c) remove `coming_soon = false` from `open_market_on_publish`, `open-market.db.test.ts` must go red; (d) put an em dash in `comingSoon.home.text`, `copy-voice.test.ts` must go red; (e) stop passing `markets` in `interest-form.tsx`, the unit test and the e2e row assertion must both go red; (f) remove the `ComingSoon` branch from `$market.index.tsx`, the e2e must go red on `/california`; (g) make `IllustrativeNotice` always render, the production-mode grep in step 7 must print 1 instead of 0.
- Production readiness, run at Stage 5 and after every production deploy: `node scripts/assert-coming-soon.mjs https://matterofplace.com` exits 0 before the first real property, and `--after-launch` afterwards.

## Risks and gotchas (link GOTCHAS ids)
- G-005: routes read through `queries` and `services`. The empty-state decision is made from the payload (`market.comingSoon`, empty lists), never from `src/data/*`. The only bundled-data mode is local, where `comingSoon: false` keeps today's behaviour.
- G-007: tokens only. `--muted` is a surface, `--muted-foreground` is text; the badge uses `--muted-foreground` on `--background`.
- G-004: `Market.comingSoon` and `interestCopy` (types), the API payload and `markets.coming_soon`, `markets.interest_copy` (columns) already agree from B2 and B3; this slice adds no field. Adding one later changes all three.
- G-006: no new `VITE_*` name. The environment marker is a database row, not a build variable, so a wrong build cannot show illustrative content on the production database.
- G-011: no paid feature. A view and three functions.
- Empty pages are thin content. `/properties` is `noindex` while empty (ASSUMED); market and region pages keep their editorial text and stay indexable. Revisit with B13.
- The guard protects the database. An illustrative property could still exist on a production database that was never marked production; `set_environment('production')` is therefore a launch checklist item and `assert-coming-soon.mjs` fails when it was skipped.
- Local mode cannot show empty states (it serves bundled data). Designers use a live-mode local stack with the reference seed; the runbook says how.
- CSP `connect-src 'self'` is enough for the signup (same-origin `POST`); no new origin.
- Cache: flipping `coming_soon` bumps `catalog_version` through the B2 trigger, so pages change within the 15-second version memo (B3), not after the 5-minute `s-maxage`.
- Screen 15 shows "interest count" per market; B7 reads `market_interest_counts`. The view counts a subscriber under every market they chose, so totals across markets can exceed the number of subscribers.
- ASSUMED question for the CEO: market and region hero photographs are illustrative imagery. Production coming-soon pages keep them with the existing `ILLUSTRATIVE IMAGERY` tag (S30 says illustrative content never shows on production). If that is too strict, `markets.image` is nullable (B2) and the market hero can render text only.

## Out of scope
The admin toggles and screens (B7), the market-opening email and the confirmation mail (B5, B11), the Place Notes audience filter (B11), a public "notify me" for a single property, waitlist positions, referral codes, SEO structured data for empty pages (B13), translating the copy, and any counter such as "N people waiting" (a social-proof claim the brand rules avoid).
