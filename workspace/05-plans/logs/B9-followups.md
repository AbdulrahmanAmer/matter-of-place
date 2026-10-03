# B9 follow-ups: the orchestrator folds or assigns each before the slice closes

## g1 · steps 1

1. `workspace/08-creative/BRIEF.md` (not blocking)
   - What: The brief contradicts itself on the cover. The cover slot line says 'No headline on the cover', but the same section's option B says 'warm ivory text column on the left with the headline and price', and cover/B.html renders 'A residence shaped around the landscape.' If the CEO picks cover B, the step 3 builder reading the slot list will leave the headline out and stop matching the chosen PNG.
   - Evidence: grep -o 'A residence[^<]*' workspace/08-creative/options/cover/*.html returns cover/B.html only. BRIEF.md ## cover reads 'Slots: image (hero), wordmark, location line, price, specs. No headline on the cover.' and 'Options: ... B, warm ivory text column on the left with the headline and price'. Confirmed by running.

2. `workspace/08-creative/options/cover/B.html` (not blocking)
   - What: Cover B breaks the brief's own cover safe area ('64 px on every side'). The wordmark, location, headline, price and specs all sit at left:56px, and the wordmark at top:56px. It is a mock and no crop removes 56 px, so nothing visibly breaks, but the option does not follow the brief that a later builder will follow.
   - Evidence: Text-position extraction on cover/B.html: 'left:56px;top:56px WORDMARK', 'cap | left:56px;top:236px', 'serif | left:56px;top:268px', 'num | left:56px;top:504px'. Confirmed by running.

3. `launch/engine/still.mjs` (not blocking)
   - What: Gap in coverage (follow-up, not a contract break). still.mjs has no test and no registry entry. Its refusal paths were proven only by hand, by the author and again by me here. A missing image is refused by the image.decode() rejection, not by the requestfailed listener the author's note implies. If a later edit drops the decode wait, nothing automated would catch it.
   - Evidence: Scratch img.html with <img src=nope.jpg> gives rc=1 'DOMException: EncodingError: The source image cannot be decoded.' Font and CSS failures give rc=1 'Page errors'. Confirmed by running.

## g2 · steps 2

1. `workspace/08-creative/DIRECTION.md` (not blocking)
   - What: In the standalone-email bullet, the footer and its rule are in the wrong order compared with the chosen option. DIRECTION.md says the footer comes 'above a 1 px sandstone rule'. In options/standalone-email/C.html the rule comes first (top:1196px) and the footer text below it (top:1212px). Step 3 builds from this file, so it would put the rule under the footer.
   - Evidence: Confirmed by reading: standalone-email/C.html has `<div ... top:1196px;height:1px;background:var(--sandstone)>` followed by the footer `<div ... top:1212px ...>You receive this ...`. DIRECTION.md line: 'footer 12 px Jost 300 with the preference and unsubscribe line and "Matter of Place, an Omnikom company" above a 1 px sandstone rule.'

2. `workspace/08-creative/DIRECTION.md` (not blocking)
   - What: The general 'Values that follow' rules contradict the picked options. (a) 'Cormorant Garamond for headline, place name and price', but in standalone-email C the price is in the 12 px Jost caps line 'California · $8,950,000', and DIRECTION's own standalone bullet says so. (b) 'Caps lines use letter spacing 0.22em', but the email link 'View the residence' and 'Property note' use 0.2em in both picked email options. Step 3 turns these values into tokens.
   - Evidence: Confirmed by reading options/standalone-email/C.html (`.cap` 'California · $8,950,000' at 12px; 'Property note' and the link at letter-spacing:.2em) and options/newsletter-block/A.html (link letter-spacing:.2em).

3. `workspace/08-creative/DIRECTION.md` (not blocking)
   - What: BRIEF.md lists these standalone-email slots: two supporting photographs and one call to action with square corners. Option C, the pick, has neither: it has one inset photograph and a text link. DIRECTION.md does not say these slots are dropped, so step 3 has to guess whether production carries the two supporting photographs.
   - Evidence: Confirmed by reading: BRIEF.md '## standalone-email' Slots line, compared with options/standalone-email/C.html (one img, link is an underlined span). DIRECTION.md says nothing about supporting photographs.

4. `workspace/05-plans/B9.md` (not blocking)
   - What: Stale plan text that is not this group's file (orchestrator to fold). Step 2, the Files list, the Observed exit and sizing/B9.json g2 still say 'the CEO's picks' and 'the operator assigns the S-number'. The picks and S65 were made by the CTO under ASSUMED H55 (2), which overrules this text.
   - Evidence: plan-brief output: 'BLOCKED until the CEO has picked ...', '(the operator assigns the S-number)'. grep in sizing/B9.json: 'DIRECTION.md from the CEO's picks'. ASSUMED.md line 250 H55 (2).

Two follow-ups on GOTCHAS.md are banked as P-705 and P-706, not listed here.

## g3 · steps 3

1. `app/src/templates/social/social.css` (not blocking)
   - What: No automated check pins the slot weights. Only a manual, uncommitted probe proves the h1 renders at 400; the author labelled this UNPROVEN. If a later edit drops line 139 (`font-weight: var(--social-weight-text)` on .social-frame__headline), every headline goes back to 700 and check stays green. Step 6's shoot/render path, or a g4 template test that runs in a browser, should assert the computed weights.
   - Evidence: My in-memory mutation removing that line made the headline 700 for carousel and story. templates.test.ts (g4) is SSR-only and cannot see the computed style. Confirmed by running.

2. `workspace/05-plans/STANDARDS.md` (not blocking)
   - What: The folder-map row for public/ (line 87) lists `fonts/*.woff2` only. The committed public/fonts/LICENSES.md is required by the plan, and app/scripts/check-layout.mjs now allows it. The document lags the gate. The author already logged this as P-704; it is the orchestrator's file.
   - Evidence: STANDARDS.md line 87: `fonts/*.woff2`. check-layout.mjs diff: `public/fonts/{*.woff2,LICENSES.md}`. Confirmed by reading.

3. `workspace/05-plans/B9.md` (not blocking)
   - What: Stale plan line. The shoot.mjs Files entry says the fixture images are "files under src/assets/gallery/", but the fixture's hero is src/assets/los-altos.jpg. Step 6's shoot.mjs must read the paths from the fixture as written, not assume the gallery folder.
   - Evidence: app/src/templates/social/fixtures/property.fixture.json images[0].path = "src/assets/los-altos.jpg". The plan-brief Files list for scripts/lib/shoot.mjs says the images are under `src/assets/gallery/`. Confirmed by reading.

Two follow-ups on GOTCHAS.md are banked as P-709 and P-710, not listed here.
