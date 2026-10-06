# B17 follow-ups: the orchestrator folds or assigns each before the slice closes

## g1 · steps 1

1. File `app/src/server/lib/headers.ts` (not blocking).
   What: withPageCsp hashes only 200 text/html responses, as the plan says. As a result the stored 404 and 410 pages, the 5xx page and g5's maintenance 503 keep the default policy with no sha256 source, while they still carry TanStack's inline bootstrap. In report-only this sends violation reports from every 404 view. Once H1 turns csp_enforce on, those pages lose hydration. The author recorded this as a plan gap. It goes to the plan owner before H1's flip.
   Evidence: Ran on the 8939 preview: curl -s -D - -o /dev/null http://127.0.0.1:8939/journal | grep -o sha256 | wc -l gives 0 (the page is a 404)

2. File `app/supabase/migrations/20261005054600_essentials_flags.sql` (not blocking).
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
