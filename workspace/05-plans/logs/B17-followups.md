# B17 follow-ups: the orchestrator folds or assigns each before the slice closes

## g1 · steps 1

1. File `app/src/server/lib/headers.ts` (not blocking).
   What: withPageCsp hashes only 200 text/html responses, as the plan says. As a result the stored 404 and 410 pages, the 5xx page and g5's maintenance 503 keep the default policy with no sha256 source, while they still carry TanStack's inline bootstrap. In report-only this sends violation reports from every 404 view. Once H1 turns csp_enforce on, those pages lose hydration. The author recorded this as a plan gap. It goes to the plan owner before H1's flip.
   Evidence: Ran on the 8939 preview: curl -s -D - -o /dev/null http://127.0.0.1:8939/journal | grep -o sha256 | wc -l gives 0 (the page is a 404)

2. File `app/supabase/migrations/20261007023009_essentials_flags.sql` (not blocking).
   What: Step 1 and R16 / E2E-06 say the migration lands in its own small pull request before the code that reads the keys. Here it sits on slice/b17 with all of step 1's code. That is harmless because defaultFlags gives false for both missing keys, but under ruling H57 the workflow has to split or merge it on its own. The CI db job, db:psql printing 'false | false' and 'migration list --linked' are UNPROVEN until main pushes it.
   Evidence: git diff origin/main...HEAD --stat lists the migration beside headers.ts, pipeline.ts and the rest; no pull request exists for the commit.

3. File `app/tests/db/flags.db.test.ts` (not blocking).
   What: The case title still reads 'exists with new_channels and archive_pages false', but it now asserts four keys including csp_enforce and maintenance. The title understates what is checked. It runs only in the CI db project, so it is UNPROVEN here.
   Evidence: sed -n 15,35p tests/db/flags.db.test.ts

4. File `app/src/domain/contracts.ts` (not blocking).
   What: cspReportBatchSchema refuses a Reporting API batch of more than 20 reports, so all of them are lost with a 400. It also refuses a legacy report that has 'violated-directive' but no 'effective-directive', which some older browsers send. Both follow the plan's 1-to-20 shape, but the loss is silent. Step 10's report-only week should check whether real batches go over 20.
   Evidence: Read by reading, not run: z.array(reportingApiViolation).min(1).max(20) and legacyViolation requires 'effective-directive'

5. File `app/src/server/lib/headers.ts` (not blocking).
   What: The CPU cost of hashing on a miss of / under workerd is still BLOCKED. The only number comes from Bun (0.59 ms CPU per call), not B1b's step 7 wrangler tail recipe, and the edge proof ran on a local wrangler dev, not the custom domain (L1, F25 j). Both are UNPROVEN and recorded by the author.
   Evidence: workspace/05-plans/logs/B17.md Proof 2 of the first g1 block

## c1 · steps 1

1. File `workspace/05-plans/B17.md` (not blocking).
   What: Contract invariant 1 still lists `upgrade-insecure-requests` in the policy for both states. The code now sends it only in the enforced header (headers.ts:97), so the plan and the code no longer agree. The plan is the orchestrator's file to fold: it should say 'enforced policy only'. The author already flagged this as UNPROVEN.
   Evidence: Read only: line 16 of B17.md contains "... object-src 'none'; upgrade-insecure-requests; report-uri /api/public/csp-report; report-to csp" with no flag condition. headers.ts:97 filters the directive out unless flags.csp_enforce === true.

2. File `app/tests/e2e` (CI e2e job) (not blocking).
   What: UNPROVEN: that the e2e job of PR 142 is green. CI runs every spec in live mode (E2E_MODE=live) across the desktop, phone, live-desktop and edge projects (ci.yml:303-307). The author and I ran only sweep.spec.ts, in local mode, on desktop and phone. GitHub Actions billing is currently blocked (P-524/P-2003), so no CI run exists for this commit. By reading only: live mode reads csp_enforce from mop-dev, where it is false or missing, and mergeFlags turns that into false, so the same branch applies. Not confirmed by running.
   Evidence: Confirmed by running: sweep desktop+phone local, 102 passed + 4 load timeouts, which passed on re-run (32 passed). Not run: live-desktop, edge, coming-soon, live mode.

3. File `workspace/05-plans/check-gotchas.mjs` (not blocking).
   What: This round edited a shared, orchestrator-owned tool (last edited in 187218b, ruling H51) that is not among the group's named files. The one-writer-per-file rule allows only gate-config entries (H46). The change itself is small and correct, and its watched-fail reproduces (exit 1 on a NUL, exit 0 clean). The orchestrator should ratify it so another lane editing the same script does not conflict with it.
   Evidence: git show --stat 67b42e9 lists workspace/05-plans/check-gotchas.mjs | 7 ++++++-. git log -- workspace/05-plans/check-gotchas.mjs shows the previous writers were orchestrator commits 187218b and ad17a24.

Recorded in the bank, not here: two follow-ups whose file is GOTCHAS.md became hit-again lines of P-713 (the 120 s foreground timeout of a by-hand replay) and P-015 (the `-g "/markets$"` path conversion), plus one on P-1805 (the four property-page sweep timeouts under load), because the bank holds those lessons already and a repeat gets a dated line, not a new entry.

## g2 · steps 2-3

1. File `app/tests/e2e/essentials.spec.ts` (not blocking).
   What: Two assertions in the e2e 'fonts' case cannot fail for the thing its title claims ('draws Jost from its own files'). First, document.fonts.check('16px "Jost"') returns true when no Jost face is declared at all. Second, the same-origin .woff2 requests are made anyway by the Link preload header that withPageCsp sends. So with the fonts.css import removed, this e2e case would still pass. The unit mutation b17-fonts-import covers the import, so nothing is unguarded today; the e2e case simply proves less than its title says. A real check would compare document.fonts entries with status 'loaded' and family 'Jost', or the computed font of a Jost element.
   Evidence: A Playwright page with no @font-face printed 'no @font-face for Jost, check() = true'. Live: curl -D - / shows 'Link: </fonts/jost-latin-wght-normal.woff2>; rel=preload; as=font ...', which makes the woff2 request without any CSS.

2. File `app/public/site.webmanifest` (not blocking).
   What: This departs from Contract invariant 17 ('theme and background in Bone/Obsidian'). theme_color is #F5F2EB (Warm Ivory), set to match the existing theme-color meta. The manifest test was widened to accept Warm Ivory in its palette list (essentials.test.ts line 715). The log discloses it, and with display: browser it has no visible effect. The orchestrator should fold the plan line, or the operator should choose.
   Evidence: site.webmanifest has "theme_color": "#F5F2EB". essentials.test.ts:715 has const palette = ["#11110F", "#EEEAE1", "#F5F2EB"].

3. File `workspace/05-plans/B17.md` (not blocking).
   What: Plan lines that no longer match what was built, for the orchestrator to fold: (a) the step 3 and Files text names @resvg/resvg-js, but icons.mjs uses sharp and no resvg dependency was added (P-1906). (b) The identity logic lives in a new src/server/public/identity.ts, which the Files list does not name. (c) src/styles/tokens.css was edited outside the group's file list; that is a one-writer risk with later lanes. (d) The __root.tsx 'font preloads' are delivered by the Link header, not head links. (e) The 'public/' row of STANDARDS.md still says 'favicons', while check-layout.mjs now also allows site.webmanifest, browserconfig.xml and the four PNGs.
   Evidence: git show f791cbb --stat lists app/src/server/public/identity.ts and app/src/styles/tokens.css. app/package.json has no @resvg/resvg-js. STANDARDS.md 1.3 public row reads '_headers, robots.txt, favicons, sw.js ...'.

4. File `app/src/routes/__root.tsx` (not blocking).
   What: The RSS and JSON Feed autodiscovery links point at /feed.xml and /feed.json, which another B17 group has not built yet. If this group reaches main before that group, every page advertises two 404 feeds. The author flagged it as UNPROVEN.
   Evidence: __root.tsx links include href "/feed.xml" and "/feed.json". There is no src/routes/feed[.]xml.ts in the 3d66bcc tree.

5. File `app/src/server/public/identity.ts` (not blocking).
   What: Open question for the operator, not a code defect: on mop-dev, security.txt reads 'Contact: mailto:hello@matterofplace.com', because settings.site.contact.email is set there. The security@ alias of E19 appears only when the setting is unset, as the plan specifies.
   Evidence: curl http://127.0.0.1:8939/.well-known/security.txt printed 'Contact: mailto:hello@matterofplace.com'.

Recorded in the bank, not here: one follow-up whose file is GOTCHAS.md (a literal NUL byte at line 622 of the bank on 3d66bcc, from group c1's commit 6f81b8a) is already entry P-1910, which this branch's head fixes and enforces in check-gotchas.mjs; it got a dated hit-again line.

## g4 · steps 5

1. File `app/src/components/layout/header.tsx` (not blocking).
   What: Suspected by reading. With the phone menu open, Tab is kept inside .menu-panel (MenuPanel gets menuRef). The visible 'Close menu' X is the .header-toggle button in the header, outside the panel, so a keyboard user can never Tab to the X they can see. Only Escape or following a link closes the menu. The search overlay and the inquiry dialog do carry their own close button inside the trap. The code follows the plan's exact wording (useModal(..., menuOpen ? menuRef : searchRef)), so this is a plan design gap, not a deviation.
   Evidence: header.tsx: the toggle is rendered inside <header> and MenuPanel is a sibling below it. menu-panel.tsx holds only the nav links, a Search button and the tagline. The a11y-keyboard menu case shows Tab never leaves the panel.

2. File `app/tests/e2e/essentials.spec.ts` (not blocking).
   What: The ring case passes on a weaker condition than the contract. focusState counts a stop as 'drawn' when it has an outline of 2 px or more OR any box-shadow. .field input, textarea and select keep `outline: none` (forms.css:20), as does .interest-email (coming-soon.css:45). They show a 1 px underline or edge box-shadow, not the contract's '2 px Obsidian outline offset 2 px'. Focus is visible, but the title 'every Tab stop ... draws a focus ring' says more than the test proves.
   Evidence: essentials.spec.ts focusState: `drawn: (outlineStyle !== 'none' && outlineWidth >= 2) || style.boxShadow !== 'none'`; grep -rn 'outline: none' app/src/styles finds forms.css:20 and coming-soon.css:45

3. File `app/src/styles/tokens.css` (not blocking).
   What: The dark-surface ring is Warm Ivory, not Bone. The tokens.css comment, the base.css comment and the e2e title all say 'Bone' (#EEEAE1, --secondary), but the dark-surface ring is var(--background), which is #f5f2eb. The test asserts rgb(245, 242, 235). The colour works; the names say otherwise. Either fold 'Ivory' into the plan's invariant 12 or point the ring at --secondary.
   Evidence: tokens.css: `--background: #f5f2eb; --secondary: #eeeae1;`; essentials.spec.ts: `expect(await ringOfBrand("/")).toBe("rgb(245, 242, 235)")`

4. File `app/scripts/contrast.mjs` (not blocking).
   What: PAIRS is a fixed list of 11 hand-picked pairs, so a new text token, or Warm Grey re-entering as a token, is never checked. G-013 was retired as 'enforced-by essentials.test.ts', but that only enforces these 11 pairs, not G-013's rule that Warm Grey is for large text only. The plan line asks it to check 'every text and surface token pair'. Today every text token present is covered.
   Evidence: contrast.mjs: `const PAIRS = [["--foreground","--background"], ...]` (11 entries); GOTCHAS.md: `- G-013 · ... · enforced-by app/tests/unit/essentials.test.ts`

5. File `workspace/05-plans/B17.md` (not blocking).
   What: Plan lines for the orchestrator to fold into the plan. (1) The skip link targets span#content before the Outlet, not main. (2) The gallery is a vertical column, and Left/Right step image rows, not one image of a strip. (3) Field is now a div holding the label, with the error outside it. (4) New file src/hooks/use-field-errors.ts is not named in the plan's Files list, and src/lib/strings.ts and tests/mutations/B4.json (entries i and hh) were edited outside the group's file list. The log names and justifies each one. (5) The root not-found and error pages render SiteChrome outside _site.tsx, so they have no skip link.
   Evidence: logs/B17.md g4 'Differences from the plan' points 1-4; git show --stat 2242a63 lists use-field-errors.ts, strings.ts and B4.json; site-chrome.tsx docblock: '`_site.tsx` and the root's not-found and error pages use it'

6. File `app/src/components/forms/submit` (not blocking).
   What: NOT DONE, and the author says so. Plan Files names 'the forms that use them (contact-form.tsx, newsletter-form.tsx, inquiry-dialog.tsx, src/components/forms/submit/*)' for described errors. submit/* and interest-form.tsx still rely on native validation, with no aria-describedby error text. The brief's group file list left them out, so this is for a later group or the orchestrator.
   Evidence: logs/B17.md: 'NOT DONE: ... described errors in interest-form.tsx and submit/*'; grep -n 'useFieldErrors' app/src/components/forms/submit/*.tsx finds nothing

Recorded in the bank, not here: two follow-ups whose file is GOTCHAS.md became three hit-again lines, in P-2125 (the shared scratchpad overwrote a reviewer's check.txt and build.txt), P-1805 (the sweep with --workers=2 timed out on two desktop property pages) and G-031 (the 20 s prettier case timed out inside bun run check).

## g3 · steps 4

1. File `app/tests/mutations/B17.json` (not blocking).
   What: The manual entry b17-e2e-consent-link (line 917) records expect "consent-link-beats-record[sS]*Analytics are off". The backslashes of [\\s\\S] were lost, so [sS]* only matches the letters s and S, and the pattern can never match Playwright output. Replayed as recorded, the watched-fail always reports BAD, even though the mutation does turn the test red for the right reason. Fix: use "consent-link-beats-record[\\\\s\\\\S]*Analytics are off", like the b17-e2e-privacy-choices entry above it. Manual entries are never replayed by G18, so no gate goes red today. The cost lands on whoever re-runs it, for example H1.
   Evidence: Confirmed by running. watchfail --file with the registry's exact fields printed 'WATCHED-FAIL BAD: wrong reason ... expected /consent-link-beats-record[sS]*Analytics are off/', and the red output showed 'unexpected value "Analytics are on."' at essentials.spec.ts:143. A node check of the regex: the recorded pattern does not match a sample Playwright failure, and /consent-link-beats-record[\\s\\S]*Analytics are off/ does.

2. File `app/tests/WATCHED-FAIL.md` (not blocking).
   What: The ledger was not updated for the rework. Line 130 still records b17-ck-prefer as the old mutation ('readRecord() ?? readCookie()' -> 'readCookie() ?? readRecord()', expect /readConsent prefers the record/), and the registry entry is now the reverse. Line 133 b17-ck-throwing, line 135 b17-cn-cookie-only and the b17-ck-fallback row find the old text too. No row records the new b17-ck-prefer or b17-e2e-consent-link. Plan B17.md Verification says each watched-fail is 'recorded in tests/WATCHED-FAIL.md'. watchfail appends a ledger row only with --record, and the rework did not use it.
   Evidence: Seen by reading: sed of WATCHED-FAIL.md lines 120-135 and grep -n 'consent-link' (no match). git show --stat aa4da1f does not list WATCHED-FAIL.md.

3. File `workspace/05-plans/B17.md` (not blocking).
   What: Contract invariant 8 and the Files line for src/lib/consent.ts still say readConsent() 'reads the record and falls back to the cookie' / 'falls back to that cookie when no localStorage record exists'. The code now reads the cookie first. That is the right order for the plan's other promise ('the stored record and the cookie can never disagree', a no-JS choice is seen once scripts run), and the author flagged it. The orchestrator should fold the plan line.
   Evidence: Seen by reading: consent.ts line 51 is 'return readCookie() ?? readRecord();'. plan-brief output, invariant 8 and the Files list.

4. File `app/tests/e2e/essentials.spec.ts` (not blocking).
   What: consent-gpc, and the reload half of consent-privacy-choices, cannot go red for a GA-load fault: the tree has no Google tag loader (B13's Ga4Loader). Plan watched-fail (e) is UNPROVEN until B13 lands. The author declared this.
   Evidence: Seen by reading the spec: both cases assert only that no Google host was requested, and nothing in the tree ever requests one. The author's unproven list says the same.

5. File `app/src/server/public/consent.ts` (not blocking).
   What: A plain GET to /api/consent?set=accept from any site, as a top-level link with a SameSite=Lax cookie, opts a visitor in to analytics. The plan specifies a GET, so this is a plan-level consent-forgery question, already raised by the author as a plan decision. R13 limits on /api/consent are also still unset. Note for the plan owner.
   Evidence: Confirmed by running: curl with 'Referer: https://evil.example/properties' and set=decline answered 303 with Set-Cookie (Location: /). Accept behaves the same by code path (read, not run with a foreign Referer).

Recorded in the bank, not here: none. No follow-up of g3's review has GOTCHAS.md as its file; the `[sS]` backslash loss of follow-up 1 is already banked as P-1915 (a hit-again line there would repeat it, and the follow-up carries the fix).

## c8 · steps 8

1. File `app/lighthouserc.local.json` (step 8 acceptance, lhci:local) (not blocking).
   What: Lighthouse local is still red on lines that ruling H61 does not cover. H61 only holds LCP and script size at warn. Also red: accessibility 0.98 on /exposure (heading-order, a real page defect), best practices 0.96 on / and /california (console 404 of /media/o/california/... because mop-dev's bucket is missing the file), and performance 0.86 to 0.92 against 0.95. The author reported all of this honestly and the close-out allowed red. Still, heading-order and the missing market image need a named owner, or the step 8 acceptance 'all four category assertions pass' can never close.
   Evidence: Confirmed by running: bun run lhci:local on 5 pages of the live build on 8939, exit 1; medians a11y /exposure 0.98 (heading-order), bp 0.96 on / and /california (errors-in-console), perf 0.86 to 0.92.

2. File `app/scripts/bundle-check.mjs` (lane budget) (not blocking).
   What: _site.$market.index has 103 gzip bytes of headroom. That was measured only on this Windows build; no CI run exists for d3f9e6f, so the bundle-check pass in CI's Linux build is UNPROVEN. The close-out also suggested folding the shared Picture chunk. That was not done (vite.config.ts untouched). The 300-byte target, set only for property.$slug, is met (498).
   Evidence: Confirmed by running: bundle-check prints 'ok _site.$market.index 153497' against 153600; the c8 log says 'The shared Picture chunk ... stays a chunk of its own'.

3. File `workspace/05-plans/B17.md` and `workspace/05-plans/trace.json` (not blocking).
   What: Two places still name src/domain/contracts.ts as the home of cspReportBatchSchema: the plan's Files list (B17.md line 76) and trace.json, whose 'POST /api/public/csp-report' item lists src/domain/contracts.ts and not src/domain/csp-report.ts. The code now lives in csp-report.ts. There is also a mismatch to settle. The new rule in P-1932 says server-only schemas go under src/domain/. The file's own comment says it is server-only. But STANDARDS section 1.3 describes src/domain/ as 'Shared contracts used by browser and server'. Either the folder-map row or the file's location needs to say so explicitly.
   Evidence: Grep cspReportBatchSchema: B17.md:76 '`src/domain/contracts.ts` — change: `cspReportBatchSchema` normalises both bodies...'; trace.json:12654-12661 files list includes 'src/domain/contracts.ts', not csp-report.ts. Orchestrator's files to fold.

4. File `app/src/components/forms/inquiry-dialog.tsx` (not blocking).
   What: Suspected by reading, not proven. The property route now mounts InquiryDialog only when intent !== null, so the dialog's null-intent handling can no longer happen in production: `intent: Intent | null`, `open = intent !== null`, `if (!intent || !copy) return null`, and the reset effect keyed on intent. Only the unit test can still reach it (C04, dead path left by this group's change). Separately, the lazy boundary has `fallback={null}` and no preload. On a slow network the first click shows nothing and does not lock scroll until the chunk arrives. If the chunk fails to load (for example an old tab after a new deploy), the error goes to the route error boundary.
   Evidence: Grep InquiryDialog: the only src caller is _site.property.$slug.tsx:336-345, wrapped in `{intent !== null && (<Suspense fallback={null}>...`. The e2e dialog cases pass (4 passed), so behaviour holds on a fast local server.

5. File `app/src/components/site/picture.tsx` (plan invariant 20) (not blocking).
   What: Suspected by reading. Picture writes `sizes` on an <img> that has no srcset: the film poster and every bundled still. The plan requires this ('Both carry sizes'). As I recall the HTML standard, `sizes` is allowed only together with `srcset`, so validators would flag every image without variants. This is a plan-line question for the orchestrator, not a defect of this group.
   Evidence: Confirmed markup by curl of the stand-in /property/tiburon-waterline: <img src="/assets/T4TFjhsO.jpg" sizes="(max-width: 416px) 100vw, 416px" ... loading="lazy" decoding="async"/>, with no srcset. The conformance claim comes from my reading of the spec and was not run through a validator.

Recorded in the bank, not here: the follow-up whose file is GOTCHAS.md (the c8 hit-again line of P-008 inserted inside the B3 g1 line) became P-1935, and the misplaced line was moved back after the B3 g1 line it had split.

## c9 · steps 9-10

1. File `app/tests/e2e/essentials.spec.ts` (not blocking).
   What: Line 572-ish, the step 9 e2e assertion meant to show 'no more than one beacon per 10 seconds' (expect(before).toBeLessThanOrEqual(1) plus exactly one vitals beacon after hidden) does not measure the rate. A one-second batch timer still passes. The plan's step 9 proof line for the rate is therefore not shown by this e2e. The rate itself is guarded independently by B3's analytics-batch.test.ts, so nothing in the product slips through.
   Evidence: Confirmed by running. With FLUSH_MS = 1_000 in src/lib/analytics.ts, a live rebuild and `E2E_TARGET=built E2E_MODE=live E2E_PORT=8939 bunx playwright test tests/e2e/essentials.spec.ts --project=desktop -g web-vitals`, the output was '1 passed (12.7s)'. The same mutation against tests/unit/analytics-batch.test.ts printed WATCHED-FAIL OK.

2. File `app/docs/runbooks/essentials.md` (not blocking).
   What: Step 10 is NOT DONE. The enforcing Content-Security-Policy header is absent (csp_enforce is not in settings.flags on mop-dev) and the gate is time-gated. Its start date ('seven days after step 1 is deployed') is recorded nowhere, so no one can compute when the flip becomes allowed. The only stored csp_report rows (3, all 2026-10-05) are synthetic test posts, not a week of field reports. The author states all of this as UNPROVEN. The runbook and log are accurate, so this is not a false statement. The orchestrator should record step 1's deploy date and schedule the H1 flip (earliest 2026-10-12).
   Evidence: Confirmed by running. `curl -sI http://127.0.0.1:8939/ | grep -i "content-security-policy:"` gave no output, exit 1. `select key, value from settings` shows flags = {"new_channels": false, "archive_pages": false}. The csp_report rows have data blocked_uri 'inline', 'https://x.test/a.png' and 'https://reviewer.test/x.png'.

3. File `workspace/05-plans/logs/B17.md` (not blocking).
   What: The step 10 proof 'no console CSP errors' rests on a 'scratch Playwright' script kept outside the repo, so the log's command cannot be re-run from the repository. The plan names the render gate for this proof. I reproduced the result with my own scratch script (0 messages over six routes), but the evidence is not replayable as written.
   Evidence: In the log's Step 10 block, the line reads '$ scratch Playwright over /, /stories, /properties, /about, /contact, /submit: console messages matching ... 0'. No repo file holds that script. My scratch reproduction printed 'csp console messages: 0'.

Recorded in the bank, not here: none. No follow-up of c9's review has GOTCHAS.md as its file.

## g10 · steps 12

1. File `app/docs/runbooks/delivery.md` (not blocking).
   What: The Previews section (lines 225-229) still says the preview job builds, deploys, waits, runs the smoke and comments. It does not mention the browser install, essentials and observatory steps this group added (or B4's change test, overflow and lighthouse). Line 200 also says the smoke is 'the last step of every deploy job', which is no longer true for preview. A runbook reader would not know the preview can go red on an Observatory API outage (exit 2) or on the essentials spec. This is not this group's file, so the orchestrator should fold it in.
   Evidence: Read of app/docs/runbooks/delivery.md:198-237; grep -rn observatory app/docs finds nothing

2. File `.github/workflows/deploy.yml` (not blocking).
   What: The essentials step is a new required gate on every preview. It can go red for reasons unrelated to the PR: the P-1936 stall (empty mop-dev media bucket, a page's load event times out under parallel load), and with failOnFlakyTests a pass on retry also fails. The observatory step exits 2 on an Observatory API outage or a 429, which follows the plan contract but also makes the preview red for a third-party reason. Run 37557550150 was red on the stall; 37563311198 was green. The author lists this as UNPROVEN and it is banked (P-1936). I am recording it as a follow-up and not blocking, because the cause is the empty bucket outside g10's files.
   Evidence: deploy.yml:155-175; GOTCHAS.md P-1936 at line 4323; B17 log rework 3 cites run 37557550150 (consent-noscript on phone)

3. File `.github/workflows/deploy.yml` (not blocking).
   What: C22: the cost comment covers only the install and essentials steps (about 2 minutes). The observatory step (one outside API call, measured 2s) has no cost line. merge-chores.md:51 asked for a cost line for both new steps. This is minor.
   Evidence: deploy.yml:161-163 cost comment sits above the install/essentials steps; the observatory comment at 171-172 has no cost

4. File `app/tests/unit/observatory.test.ts` (not blocking).
   What: The structural deploy.yml tests use describe.skipIf(!existsSync(DEPLOY)), so if the workflow moves or the path resolution breaks they skip silently and do not fail. In CI and in this snapshot the file exists and all 16 tests ran, so this does not affect the current proof.
   Evidence: observatory.test.ts: describe.skipIf(!existsSync(DEPLOY))("the preview steps of deploy.yml (step 12)", ...)

5. File `.github/workflows/deploy.yml` (not blocking).
   What: The brief says the essentials step must set E2E_MODE=live 'like the overflow step'. The author used `${{ env.HAS_DB == 'true' && 'live' || 'local' }}` instead, so it falls back to local after the launch switch, while the overflow step stays unconditionally live. Today it evaluates to live (the job log shows 'E2E_MODE: live'), and b17-deploy-essentials-live pins it. This is a deliberate, documented divergence between two adjacent steps; the author logged overflow's post-switch break as another group's problem.
   Evidence: deploy.yml:169 vs 196; CI log 'preview essentials ... E2E_MODE: live'

Recorded in the bank, not here: the follow-up whose file is GOTCHAS.md (a watched-fail replay in the same tree as `bun run check`, hit again in the g10 review) became a hit-again line of P-2018.

## c8 · steps 8

1. File `app/lighthouserc.local.json` (not blocking).
   What: Lighthouse local did not reproduce in the reviewer's environment. Every run, on every page, stopped with NO_NAVSTART before producing a score. The author's medians (perf 0.72 to 0.91, LCP 2.86 to 3.27 s, bp 0.96 on / and /california, a11y 0.98 on /exposure, CLS 0) are UNPROVEN by this review. The outcome is the same red exit either way, and the author already marked this proof pass:false. Step 8's acceptance line ('all four category assertions and the budget pass on five pages', and performance, accessibility and best practices on the property page) is still NOT DONE. The step must not be counted as closed in the ledger until it goes green or a ruling waives it beyond H61.
   Evidence: Confirmed by running, three times: bun run lhci:local -- --collect.url=http://127.0.0.1:8939/... -> 'Run #1...failed! ... (NO_NAVSTART)', exit 1. The same error appeared with a single URL and numberOfRuns=1, so it does not depend on the page. Two approaches failed, so this is BLOCKED. It would unblock with a Lighthouse run from the operator's normal shell, or a check of whether the agent shell's sandbox blocks Chrome tracing.

Recorded in the bank, not here: three follow-ups whose file is GOTCHAS.md became P-1950 (Lighthouse NO_NAVSTART from an agent shell), a hit-again line of P-068 (a hand `git checkout` during a registry replay) and a rewording of the point-in-time count in P-1949.

## c9 · steps 9-10

Second review round of c9 (the review of the fix round, snapshot c25e232, hand-in a17fe8df). The earlier block of this name above is the first round.

1. File `GOTCHAS.md` (not blocking).
   What: The beacon-capture cost the author lists under costTime is filed under the wrong entry. They name P-1919, but P-1919 is about knip flagging public/sw.js as an unused file. The gotcha they actually hit again is P-1316 ('Playwright reports a sendBeacon request without its body', where postData() is null for a Blob beacon). P-1316 has no hit-again line for c9, so this cost is not banked anywhere. Next step: add a 2026-10-08 B17 c9 hit-again line under P-1316. It should say that page.route plus postDataBuffer() plus route.continue() reads the body and still lets the beacon reach the Worker, and the proof is the by-id select.
   Evidence: Confirmed by running: grep -n -A14 '^## P-1919' GOTCHAS.md shows the title 'A script the browser loads by URL (public/sw.js) is an unused file to knip'. grep -n -i 'postData|sendBeacon' GOTCHAS.md finds only P-1316 (line 3128) and related lines. The 7-line P-1919 block has no c9 line. P-1316's block ends at 'added: 2026-10-04' with no hit-again line.
   Recorded in the bank, not here: the hit-again line now sits under P-1316.

2. File `app/docs/runbooks/essentials.md` (not blocking).
   What: Line 65 is now partly stale. It says the flags route is B8b's and 'UNPROVEN until B8b lands'. The merge 4e5ba273 brought in B8b's PUT /api/admin/automation/flags (automation.flags.ts, putFlags, action automation.flags_put), so the route has landed. The Admin, Settings, Flags editor (FlagsSection) is still not in the tree, so step 1 still cannot be done by hand. Line 59 ('B13 loader src/lib/ga4.ts is not on the branch') is still true. The c9 log line 'automation.flags.ts does not exist' was true at c25e232 when written, so it is not a false log line. This is a stale line for whoever next edits the runbook: it should say the route has landed and the UI is pending.
   Evidence: Confirmed by running: git ls-tree on c25e2326 and a17fe8df prints flags:0, on 4e5ba273 and e527164a it prints flags:1. src/routes/api/admin/automation.flags.ts defines PUT with action automation.flags_put. grep -rln FlagsSection app/src finds nothing.

3. File `app/tests/e2e/essentials.spec.ts` (not blocking).
   What: The step 9 database-count proof is still a scratch script outside the repo. The repo's web-vitals e2e answers /api/public/events with 204 inside the browser, so no replayable proof in the repository shows a beacon reaching analytics_events. The plan's 'no more than one beacon per 10 seconds' is also still not measured by this e2e. The author already lists both as UNPROVEN. Recorded so the open item is not lost.
   Evidence: Suspected by reading, with the author's own log quote: 'the web-vitals e2e answers the events route with 204 inside the browser, so it writes no row'. My independent scratch browse with route.continue() did reach the database (2 rows by id). That confirms the behaviour, not a repository proof.
