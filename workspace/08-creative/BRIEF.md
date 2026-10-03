# Creative brief: the five owned templates (B9, direction, part one)

Every published property produces its own creative. This brief fixes what each template is, where things may sit and what they may never carry. Each template has three options (A, B, C) in `workspace/08-creative/options/<template>/`, rendered from one fixture property with the real tokens, so the CEO picks one per template. The picks are recorded in `DIRECTION.md` (five rows) before any production template is built.

## Fixture property (all fifteen options)

| Slot | Value |
|---|---|
| Source | `app/src/data/properties.ts`, id `mop-001`, slug `oak-hill-residence` (illustrative; production never shows an illustrative property) |
| Name | Oak Hill Residence |
| Location line | LOS ALTOS HILLS · CALIFORNIA |
| Headline | A residence shaped around the landscape. |
| Deck | Long, low stone volumes open onto terraces that follow the contours of the site. |
| Price | $8,950,000 |
| Specs | 5 BED · 4.5 BATH · 4,320 SF |
| Photographs | `app/src/assets/los-altos.jpg` (hero, 1600×1104), `gallery/ca-living.jpg`, `ca-terrace.jpg` (1600×1104), `ca-stair.jpg`, `ca-kitchen.jpg` (1024×1312) |

## Brand rules that hold for every template

- Palette only: Obsidian #11110F, Bone #EEEAE1, Warm Ivory #F5F2EB, Sandstone #C9C0B2, Mineral Grey #575751, Warm Grey #8B877F. Photography supplies the colour. The options read the palette from `brand/colors/palette.css` and the faces from `brand/typography`.
- Type: Cormorant Garamond for the headline and the price, Jost for the location line, specs, deck and link (Urbanist is for the interface, not used in the creative). Large display, small body, nothing bold, no synthetic italic.
- Mark: the horizontal wordmark from `brand/logo/wordmark`, small (14 to 20 px tall at the template's own scale), always on a solid field or a dark, quiet part of the photograph, never on sky or branches. The emblem is not used as decoration.
- Grammar: small wordmark, dominant image, LOCATION, price, minimal specs. Price never leads the page by size alone in a way that reads as a sale; it sits with the location and specs as a fact.
- Forbidden: gradients, glow, gold, rounded cards, shadows, counters that sell ("3 left"), "JUST LISTED", agent headshots, em dashes, "stunning", "dream home", "must-see", any promise of leads, buyers or sales. Only a flat obsidian veil over a photograph is allowed, for legibility (S51). Markets are California, New York and Florida.
- Slots are filled from data only. A missing slot hides its element; the layout never shows a placeholder.

## cover

- Size: 1200×630 PNG. Channel crops rendered beside it by the production step: X 1200×675, LinkedIn 1200×627.
- Safe area: 64 px on every side; everything that must survive the 627 px crop sits between y 6 and y 624.
- Slots: image (hero), wordmark, location line, price, specs. No headline on the cover.
- Options: A, photograph on top with a solid obsidian band below holding location, price, specs and the wordmark. B, warm ivory text column on the left with the headline and price, photograph filling the right two thirds. C, full-bleed photograph under a flat 40% obsidian veil, a very large price, specs and wordmark on one baseline.

## carousel

- Size: 1080×1350 PNG per slide, 6 to 8 slides; the options show slide 1 of 7. A 1080×1080 LinkedIn set of the first 3 or 4 images is cut by the production step.
- Safe area: 72 px margins; no text in the outer 72 px.
- Slots on slide 1: image, wordmark, "01 / 07" position, location line, headline, price, specs. Later slides carry one image and at most one caption line.
- Options: A, photograph over a solid obsidian band that holds wordmark, location, headline, price, specs. B, warm ivory page with the photograph as an inset plate and the text beneath, like a journal plate. C, obsidian page, photograph on top, a large headline, a hairline, specs and price on one row, wordmark at the foot.

## story

- Size: 1080×1920 PNG.
- Safe area: nothing that must be read in the top 250 px or the bottom 340 px (platform interface); side margin 72 px. All text sits between y 250 and y 1580.
- Slots: image, wordmark, location line, price, specs; headline only where the layout has room (B and C).
- Options: A, full-bleed portrait photograph (the stair) under a flat 34% veil, price large. B, warm ivory page with an inset photograph, headline, price and beds and baths. C, obsidian page, photograph over the upper 56%, wordmark, headline, price and specs below.
- The portrait fixtures are 1024×1312 and are enlarged about 1.5 times for a full-bleed story; real uploads are larger (variant widths come from B2).

## newsletter-block

- Size: 600 px wide, 720 px tall in the options (the block grows with its text in production). Rendered by the email layer at 600 px, so every option is a single column.
- Safe area: 40 to 48 px side margins.
- Slots: image, location line, headline, deck (one sentence), price, specs, link "View the residence". No wordmark: the newsletter shell carries it.
- Options: A, image above, text below on warm ivory. B, headline first, then an inset image, then deck, price and link, on bone. C, obsidian block with a tall image above and price and specs on one line.

## standalone-email

- Size: 600 px wide, 1280 px tall in the options (Campaign tier only, S24; production length follows the content).
- Safe area: 40 px side margins; the layout is single column and survives a table build (no overlap, no negative space tricks).
- Slots: wordmark, hero image, location line, headline, two sentences of deck, price, specs, one call to action "View the residence" (square corners), two supporting photographs, footer with the preference and unsubscribe line and "Matter of Place, an Omnikom company".
- Options: A, centred on warm ivory with a solid obsidian button and two supporting photographs. B, obsidian, left aligned, outlined button, one wide supporting photograph. C, bone, editorial: the place name as a large Cormorant line, an inset photograph with a caption, three numbered features, a text link.

## How the options were made

`node launch/engine/still.mjs workspace/08-creative/options/<template>/<A|B|C>.html <w> <h> workspace/08-creative/options/<template>/<A|B|C>.png` (static HTML and CSS, Chrome, fonts and images settled before the shot). `sheet.jpg` in each folder tiles A, B and C at one height and their true proportions; `launch/engine/sheet.mjs` forces every tile to 16:9, which squashes the portrait templates, so it is not used for these sheets.
