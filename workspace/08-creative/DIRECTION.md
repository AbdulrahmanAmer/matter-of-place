# Creative direction: the five owned templates (B9, direction, part two)

Decision S65 in PROJECT-STATE (CTO under S63 and H55 (2), 2026-10-03; the operator may overrule any row, and a changed row changes this file first). The options judged are in `workspace/08-creative/options/<template>/`, rendered from the fixture property in `BRIEF.md`; the grammar and the forbidden list there still bind every template. No template is built before this file has five pick rows.

## Picks

| template | pick | why, in one sentence |
|---|---|---|
| cover | A | The photograph leads and the facts sit on a solid obsidian band with the wordmark, so the price reads as a fact beside the location and not as the headline (the cover carries none). |
| carousel | A | It uses the cover's grammar, so a post and its cover read as one family, where B is a second system and C lets the headline outweigh the photograph. |
| story | C | An obsidian page with the photograph above and the text on a solid field below keeps every line inside the platform safe area and does not lead with the number. |
| newsletter-block | A | The image above and the text below on warm ivory put the price with the specs and end on an underlined link, which suits a single column that mail clients render the same way. |
| standalone-email | C | Bone and editorial, with the place name as the Cormorant line, an inset photograph with a caption and three numbered features, it reads as a note from a publication and not as a mailer. |

Two families, by channel. Social is the photograph plus an obsidian band: cover A, carousel A, story C. Email is ivory editorial: newsletter-block A on warm ivory, standalone-email C on bone.

## Values that follow

Colour is named by palette colour (from `brand/colors/palette.css`); step 3 maps each name to a token and adds the `/* social */` block to `src/styles/tokens.css` before any template (G-007). Email colours come from the generated `src/templates/theme.gen.ts` (B5), not from this file. Faces: Cormorant Garamond for headline, place name and price (weight 400 for text, 500 for the price and numerals), Jost for location, specs, deck, link and caption. Nothing bold, no synthetic italic. Caps lines use letter spacing 0.22em (specs 0.2em in social, 0.18em in email). Rules are 1 px sandstone. No gradient, shadow or radius anywhere.

Common to the social family
- Band: solid obsidian. Wordmark: horizontal bone wordmark, 16 to 20 px tall, on the band only.
- Location line: sandstone caps. Headline and price: bone. Specs: bone caps. The position marker (carousel) is bone caps.
- The photograph is cropped with `object-fit: cover`; the band never overlaps it.

Cover (1200×630)
- Margin 64 px on every side. Photograph 1200×440 from the top, band 190 px.
- Wordmark 16 px tall, right edge at the margin, top of the band plus 28 px. Location 14 px caps at the left margin, top of the band plus 26 px. Price 60 px Cormorant, below the location. Specs 14 px caps, right edge at the margin, on the price baseline.
- The option sheet draws the photograph at 480 and the band at 150 px; that puts the price 34 px from the bottom edge, inside the 64 px margin that BRIEF.md sets, so production uses 440 and 190. Everything stays between y 6 and y 624 for the LinkedIn crop. The X crop (1200×675) extends the photograph by 45 px and keeps the band.

Carousel (1080×1350, slide 1 of 7)
- Margin 72 px. Photograph 1080×920 from the top, band 430 px.
- In the band: wordmark 18 px tall and the position marker "01 / 07" (15 px caps) on one line, 40 px under the photograph; location 15 px caps; headline 58 px Cormorant, line height 1.04, width 900 px, two lines; price 44 px Cormorant; specs 14 px caps on the price baseline at the right margin.
- The option sheet draws the photograph at 960 px; that puts the price row at y 1306, inside the outer 72 px, so production uses 920 and every band row keeps its distance from the photograph: the price row ends at y 1266. Later slides carry one photograph and at most one caption line in the same band.

Story (1080×1920)
- Side margin 72 px; every line sits between y 250 and y 1580. Photograph 1080×1080 from the top, then the obsidian page.
- Wordmark 20 px tall at y 1136. Location 19 px caps, headline 72 px Cormorant over two lines (width 900 px), price 64 px Cormorant, specs 18 px caps, stacked at the left margin with the option's spacing (location y 1236, headline y 1278, price y 1462, specs y 1546; the last line ends at y 1566).

Newsletter block (600 px wide, single column)
- Page warm ivory. Side margin 40 px. Photograph full width, 390 px tall in the sample, then:
- Location 12 px caps in mineral grey; headline 36 px Cormorant in obsidian; deck 15 px Jost weight 300, line height 1.55, mineral grey, one sentence; a 1 px sandstone rule; price 30 px Cormorant weight 500; specs 11 px caps in mineral grey; link "View the residence" 12 px caps, 1 px obsidian underline, right aligned beside the price. No wordmark: the newsletter shell carries it.

Standalone email (600 px wide, Campaign tier only)
- Page bone. Side margin 40 px; a table build, no overlap.
- Wordmark 14 px tall in obsidian at the left, "Property note" 11 px caps in mineral grey at the right; the place name 70 px Cormorant, line height 0.98; one caps line of state and price, 12 px in mineral grey; inset photograph 520 px wide with a 12 px Jost caption beneath; headline 34 px Cormorant; deck 15 px Jost weight 300, line height 1.6; three numbered features between 1 px sandstone rules (numerals 18 px Cormorant 500 in warm grey, text 15 px Jost 300); specs 11 px caps; text link "View the residence" 12 px caps with a 1 px obsidian underline; footer 12 px Jost 300 with the preference and unsubscribe line and "Matter of Place, an Omnikom company" above a 1 px sandstone rule.
- Warm grey has no app token today; the numeral colour comes from the generated email theme.

Not carried over from the options
- The option PNGs are for choosing; production renders from the same grammar with data, hides any empty slot and shows no placeholder.
- The fixture property is illustrative; production shows none.
