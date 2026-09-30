# Visual pass defects (decision S40)

Evidence: `before/*.png` (18 routes x 1440 and 390, full page), `before/states/*.png` (viewport shots of header at scroll,
search overlay, menu panel, dialogs, concierge, sticky bar, filters, focus, newsletter), `before/report.json`
(horizontal overflow at 1440 and 390: none on the page; one clipped scroller, see D-15). Severity: blocks = unreadable,
broken or hidden; hurts = visible inconsistency or misalignment a visitor notices; polish = refinement.

| ID | route | viewport | defect | severity | file |
|---|---|---|---|---|---|
| D-01 | /exposure | both | FAQ items carry both `fp-fold` and `fp-faq` styles: double rules, 48px gap between every item, question set in 14px instead of the serif scale | blocks | src/routes/exposure.tsx |
| D-02 | /property/* , /california/guide, market and region heroes | 1440 | image-hero scrim starts too low: the eyebrow (location, "GUIDE") is white on bright sky and reads as "LOS" | blocks | src/styles/components/hero.css |
| D-03 | /property/* | 390 | fixed sticky action bar (56px) covers the footer copyright line at page end; nothing reserves space | blocks | src/styles/components/dialogs.css |
| D-04 | search overlay | 390 | placeholder "Where would you like to look?" is clipped at 28px | hurts | src/styles/layout/overlays.css |
| D-05 | About, Legal, Editorial standard, Home idea, property (Begin a conversation, Represented by), Submit, Contact | both | h2/h3 have no line-height, so wrapped headings inherit 1.5 and break into loose lines ("Begin a / conversation.", "An Omnikom / company") | hurts | src/styles/base.css |
| D-06 | / (hero) | 390 | headline and eyebrow sit on the brightest part of the photo; the scrim ends too early on phone | hurts | src/styles/components/hero.css |
| D-07 | /property/* | 1440, 390 | gallery is inset 12px / 8px while everything else uses .section-wrap padding: images do not align to the page grid | hurts | src/styles/components/gallery.css |
| D-08 | /submit, /contact, inquiry dialog | both | fields mix underline inputs at 12px with boxed 16px selects and textareas; rows misalign (City vs State), inputs under 16px trigger iOS zoom | hurts | src/styles/components/forms.css |
| D-09 | /faq, /exposure, About, Legal, Submit | 1440 | three different reading columns (FAQ 900, copy 1000, exposure 600) start at three different x positions under a left-aligned title | hurts | src/styles/pages/content.css, pricing.css |
| D-10 | /exposure | 1440 | four product cards and six steps stacked in one 368px column; long, narrow, no relation to the page grid | hurts | src/styles/pages/pricing.css |
| D-11 | /properties | 1440 | finder block 900px wide with its own rule under it; Find button is 30px next to a 68px textarea | hurts | src/styles/pages/home.css |
| D-12 | /california, region pages | 390 | region tabs clipped mid-word ("ORANGE COUI") with no cue | hurts | src/styles/components/filters.css |
| D-13 | all inputs | both | focus is a 1px colour change on a 1px underline; nearly invisible | hurts | src/styles/components/forms.css |
| D-14 | property cards everywhere | both | title column narrowed by the price column (orphans such as "house."); price and location baselines differ by 2px | hurts | src/components/site/property-card.tsx, cards.css |
| D-15 | /property/* | both | "The property" and "Represented by" headings touch their first paragraph (no bottom margin) | hurts | src/styles/components/sections.css, pages/property.css |
| D-16 | /properties (filters) | 390 | filter selects wrap into ragged rows of unequal width | polish | src/styles/components/filters.css |
| D-17 | property "More in" | 1440 | three related cards in a two column grid leave an orphan | polish | src/styles/pages/property.css |
| D-18 | /property/* | 1440 | Ask Matter of Place button sits on the Save/Share pills until scroll | polish | src/styles/components/dialogs.css |
| D-19 | /legal, all page intros | both | h1 descender touches the lede | polish | src/styles/pages/content.css |
| D-20 | tokens.css | n/a | breakpoint comment says the menu appears at 1100px; code collapses at 1280px | polish | src/styles/tokens.css |
| D-21 | markets.css | n/a | empty `@media (max-width: 700px) {}` | polish | src/styles/pages/markets.css |
| D-22 | 404, market cards | both | widow words ("map.", "Jolla") | polish | src/styles/pages/content.css, cards.css |
| D-23 | phone, several pages | 390 | stacked section padding leaves 200px+ blank bands (Terraces above the cove, share cover, Place Notes) | polish | src/styles/components/sections.css, filters.css |
| D-24 | /property/* | 1440 | "In particular" and "The place" columns start at different x (354 vs 493 of 960) | polish | not fixed (layout language) |
| D-25 | /california | both | "New to California" repeats properties already shown above (content, not visual) | polish | not fixed (content) |
| D-26 | RouteError | both | shares `.not-found`; not reproducible without forcing an error | polish | UNPROVEN in screenshots |

Counts: blocks 3, hurts 12, polish 11 (D-24 to D-26 are deliberately left).

## Status after the pass
Fixed: D-01 to D-17, D-19 to D-23 (D-23 partly: collection and share-cover padding on phone; other section bands kept).
Remaining polish: D-18 (Ask button meets Save/Share until scroll, a fixed button by design), D-24 (column starts, layout
language), D-25 (content), D-26 (RouteError not rendered; shares `.not-found`, which was checked at 404).
Extra check: `overflow.mjs` at 320, 360, 768, 1024, 1281 and 1366 across 17 routes reported `issues 0` (no horizontal
overflow, header nav never touches the brand).
