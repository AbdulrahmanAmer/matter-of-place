# Matter of Place: commercial recalibration

Evolve the current build to the new brief. Keep the visual identity, fonts, spacing and calm tone. No redesign, no cloud services.

## What changes for visitors

**Positioning.** A selective real-estate media platform for existing residential property in California, New York and Florida. Final line: "Exceptional property. Properly considered." Remove every mention of developments, global reach, leads, guarantees, price-band tiers, memberships and brokerage.

**Navigation.** Properties · California · New York · Florida · Stories · Property Exposure · About, plus a quiet "Submit a Property" action. The phone menu mirrors it.

**Footer.** Four groups: Matter of Place (Properties, the three markets), Editorial (Stories, Editorial Standard, About), For Professionals (Property Exposure, Submit a Property), Company (Contact, Privacy, Terms). Plus the one-line brand statement and a discreet Omnikom line.

**Homepage, in nine sections.**
1. Opening image with the headline, a short line, and "Explore Properties" and "Submit a Property".
2. The Current Edit: an image-led grid showing place, short title and style.
3. Three markets, one editorial point of view.
4. The idea: "Not every property needs more marketing. The right property needs better attention."
5. How it works: Selected, Edited, Published, Distributed.
6. Property Exposure: four quiet cards ($295, $695, $1,495, $1,250).
7. Beyond owned media: precision distribution, media from $250.
8. Editorial standard: the qualities we look for.
9. "A property worth attention?" with a link to submit.

**Property Exposure (single pricing page).**
- The Feature $295, The Reach $695 (marked recommended), The Campaign $1,495 with a suggested media budget of $500 to $2,500+, and Five Features $1,250.
- Programmatic media from $250. Management is 15% of spend, with a $100 minimum. Formats are listed, and channels vary by campaign.
- How selection works, in six steps.
- The brief's seven FAQ answers.
- `/pricing` sends visitors to `/exposure`, so there is one source of prices.

**Markets.** Clean addresses `/california`, `/new-york`, `/florida`, each with an intro, current properties, selected stories, a light neighborhood filter and recent additions. Regions follow the brief:
- CA: Los Angeles, Malibu, Beverly Hills, Westside, Orange County, Bay Area, Wine Country.
- NY: Manhattan, Brooklyn, Hamptons, Hudson Valley, Upstate.
- FL: Miami, Miami Beach, Palm Beach, Fort Lauderdale, Naples.

Old `/markets/...` addresses redirect to the new ones.

**Stories.** Place Notes becomes `/stories`: an index plus a story page, with categories Architecture, Interiors, Places and Stories. The sample stories are clearly labelled illustrative.

**Editorial Standard.** A new short page at `/editorial-standard`. It lists what we look for and states that payment does not override selection.

**Property page.** Story first: opening image, location, title, short deck, image sequence, narrative, architecture and provenance, a few facts, attribution, inquiry, share and related homes. The fact table gets smaller.

**Submit a Property.** Reads like submitting to a publication. It uses the brief's field list (address, architect, designer, years, agent, links, significance, preferred exposure, optional media budget, rights). State is limited to CA, NY and FL, with a calm notice if the property is elsewhere. It ends with a visible review timeline: Submit, Review, Acceptance, Exposure, Publish, Distribute.

**About.** Rewritten from the brief's "Real estate is not simply inventory" text.

**Removed.** The Developments pages and their data, development inquiry paths, and the Studio and Portfolio offers. The old add-ons and paid-distribution copy are replaced.

## Technical details
- `src/data/exposure.ts` and `src/domain/exposure.ts` are rewritten: four packages, programmatic terms and exposure FAQ. `pricing.tsx` becomes a redirect.
- Delete `developments*` routes, `src/data/developments.ts`, `src/domain/development.ts`, the development card and styles. Remove them from services, queries, sitemap and contracts (drop the `development` intent and submission type).
- New routes: `california.tsx`, `new-york.tsx`, `florida.tsx` (a shared market view) with `$region` children, `stories.index.tsx`, `stories.$slug.tsx`, `editorial-standard.tsx`. `markets.*` and `place-notes` redirect.
- `domain/contracts.ts`: states enum CA/NY/FL, USD only, and new submission fields. Add submission states Submitted through Completed and editorial roles (Chief Editorial Officer through Commercial Partnerships) as types for the backend.
- `docs/database/schema.sql` and the docs: remove developments; add stories, campaigns, campaign_reports (dates, spend, impressions, reach, clicks, views, CTR, geography, channel mix), package and status columns, and an editorial-approval gate so the commercial role cannot activate before acceptance. Update the ERD and flows.
- Rebalance the sample properties toward the new regions, keeping all of them labelled illustrative. Add architect and designer fields.
- Copy follows the brief's use/avoid lists, with no em dashes. Every page gets its own head(), and sitemap entries are updated.
- Verify: typecheck, lint, and a browser sweep at 1280 and 390 wide across every page and the submit flow.
