# Visual pass report (S40)

Branch `fix/visual-pass`. Method: `shoot.mjs` (18 routes x 1440/390 full page), `states.mjs` (viewport states),
`overflow.mjs` (six widths), `sticky.mjs` (phone page end). Before in `before/`, after in `after/`, pairs in `pairs/`
(left = before, right = after). Defect table: `DEFECTS.md`.

Archived 2026-10-02 (S54 cleanup): the raw full-page shots in `before/` and `after/` (132 files, about 145 MB) were
removed from the tree and are ignored from now on. They remain in history at commit `f9fa95e`
(`git checkout f9fa95e -- workspace/08-visual-pass/before workspace/08-visual-pass/after`), and the shooters
regenerate them. The ten pairs this report cites stay.

Counts: found 26 (blocks 3, hurts 12, polish 11). Fixed 22 (blocks 3, hurts 12, polish 7). Remaining 4 polish.

## Top ten before/after
1. D-01 Exposure FAQ: `pairs/01-exposure-faq-1440.png`. Double rules and 48px gaps gone; class clash removed.
2. D-10/D-09 Exposure layout: `pairs/02-exposure-layout-1440.png`. Cards 2x2, steps in three columns, same column as About/FAQ.
3. D-02 Hero eyebrow legibility: `pairs/03-hero-legibility-1440.png`. Location line was unreadable on bright sky.
4. D-05 Heading line-height: `pairs/04-headings-390.png` (About, phone). Wrapped headings no longer loose.
5. D-03 Sticky bar over footer: `pairs/05-sticky-footer-390.png`. Copyright line bottom 804px vs bar top 788px before; 748px after.
6. D-04 Search placeholder: `pairs/06-search-390.png`.
7. D-08/D-13 Forms: `pairs/07-forms-1440.png`. One field style, 16px controls, stronger focus line.
8. D-07 Gallery on the page grid: `pairs/08-gallery-1440.png`.
9. D-14 Property cards: `pairs/09-cards-390.png`. Full-width titles, price on the location baseline.
10. D-16/D-12 Filters and region tabs on phone: `pairs/10-filters-390.png`.

## Remaining polish
D-18 Ask button meets Save/Share pills at first paint on desktop. D-24 details and place columns start at different x.
D-25 "New to California" repeats properties (content). D-26 RouteError not rendered in a screenshot (UNPROVEN, shares
`.not-found`). Also not touched: Legal h2 scale (large for legal copy), Reach card offset by its label.
