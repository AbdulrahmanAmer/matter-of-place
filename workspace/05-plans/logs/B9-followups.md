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
