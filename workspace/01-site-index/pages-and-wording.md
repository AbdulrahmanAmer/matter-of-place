# Matter of Place: pages and wording index

Extracted verbatim from `E:\Matter Of Place\app` (React 19 + TanStack Start). Nothing was modified in the codebase.

Conventions used below:
- `pageHead()` (src/lib/seo.ts) builds every page title as `<title> | Matter of Place` (suffix added unless already present), sets og:title, og:description, og:type (`website`, or `article` where noted), og:url, `twitter:card = summary_large_image`, and a canonical link. Titles below are the code value BEFORE the ` | Matter of Place` suffix unless stated.
- `siteConfig` (src/config/site.ts): name `Matter of Place`; tagline `Exceptional property. Properly considered.`; description `An editorial real-estate media platform for exceptional residential property in California, New York and Florida.`; parentCompany `Omnikom`; url default `https://matterofplace.com`; contact.email = null, contact.phone = null, legal.entity = null, legal.address = null (so those lines do not render); social.instagram from env `VITE_INSTAGRAM_URL` (null by default).
- Root `head()` (src/routes/__root.tsx): title `Matter of Place`, theme-color `#F5F2EB`, og:site_name `Matter of Place`, og:locale `en_US`. Layout shell = Header, Outlet, Footer. notFound and error components below.
- `{data: file.field}` notation marks copy that comes from a data file at render time.

---

## 1. Route table

| URL | Route file | Purpose | Data it loads | head() title + description |
|---|---|---|---|---|
| (root layout) | src/routes/__root.tsx | Shell: Header, Outlet, Footer; 404 and error UI | queryClient context only | title `Matter of Place` (siteConfig.name), no description |
| `/` | src/routes/index.tsx | Home: hero carousel, statements, selected properties, markets, how it works, exposure, submit CTA | propertiesQuery, marketsQuery; hero = heroProperties(...), featured = featuredProperties(...).slice(0,6) | title in code `Matter of Place | Exceptional property. Properly considered.`; description = siteConfig.description ("An editorial real-estate media platform for exceptional residential property in California, New York and Florida."); JSON-LD Organization |
| `/properties` | src/routes/properties.tsx | Property collection with natural-language finder, search, filters | propertiesQuery, marketsQuery; search param `q` | `Properties` / "A quiet selection of places with something to say: residences across California, Florida and New York, searchable by place, price, type and architecture." |
| `/property/$slug` | src/routes/property.$slug.tsx | Single property dossier | propertyQuery(slug), propertiesQuery, marketsQuery; related = relatedProperties(...,3) | `{property.title} {property.city}` / `{city}, {state}: {beds} bedrooms, {interiorSqFt} sq ft, {style lowercased} architecture and a sense of place.`; og:type article; JSON-LD SingleFamilyResidence. Unresolved: `Property unavailable` / `This property could not be found.` (noindex) |
| `/markets` | src/routes/markets.index.tsx (layout: markets.tsx, Outlet only) | Three market desks index | marketsQuery | `Markets` / "California, New York and Florida. Three markets, one editorial point of view." |
| `/markets/$` (splat) | src/routes/markets.$.tsx | Redirect | none | none (redirect) |
| `/$market` (california, florida, new-york) | src/routes/$market.index.tsx (layout: $market.tsx, Outlet only) | Market desk page | marketQuery(market), propertiesQuery, storiesQuery | `{market.name}` / `{first sentence of market.intro}. Property stories across {region names joined ", "}.` Unresolved: `Market unavailable` |
| `/$market/guide` | src/routes/$market.guide.tsx | Market guide | marketQuery(market) | `{market.name} guide` / `Neighborhoods, what buyers and sellers ask for, and how we work in {market.name}: {region names joined ", "}.` og:type article. Unresolved: `Guide unavailable` |
| `/$market/$region` | src/routes/$market.$region.tsx | Region collection | marketQuery, propertiesQuery | `{region.name}, {market.name}` / `{region.intro} Properties in {region.places joined ", "}.` Unresolved: `Region unavailable`. Has legacy-slug redirect |
| `/stories` | src/routes/stories.index.tsx (layout: stories.tsx, Outlet only) | Stories index + newsletter | storiesQuery | `Stories` / "Architecture, interiors and places across California, New York and Florida, from the Matter of Place editorial desks." |
| `/stories/$slug` | src/routes/stories.$slug.tsx | Single story | storyQuery(slug), propertiesQuery | `{story.title without trailing period}` / `{story.deck}`; og:type article. Unresolved: `Story unavailable` |
| `/place-notes` | src/routes/place-notes.tsx | Redirect | none | none (redirect) |
| `/editorial-standard` | src/routes/editorial-standard.tsx | What the editorial standard looks for | data/exposure.ts editorialQualities | `Editorial Standard` / "What Matter of Place looks for in a property: architecture, design, originality, materiality, setting, history, craft and sense of place. Price is not the measure." |
| `/submit` | src/routes/submit.tsx | Property submission wizard | none | `Submit a Property` / "Submit an existing residential property in California, New York or Florida for editorial review." |
| `/exposure` | src/routes/exposure.tsx | Property Exposure products, distribution, selection steps, FAQ | data/exposure.ts | `Property Exposure` / "The Feature $295, The Reach $695, The Campaign $1,495 and Five Features $1,250. Editorial presentation with precision distribution, after editorial review."; JSON-LD FAQPage from exposureFaq |
| `/pricing` | src/routes/pricing.tsx | Redirect | none | none (redirect) |
| `/about` | src/routes/about.tsx | About | none | `About` / "Matter of Place is an independent real-estate media platform for exceptional residential property in California, New York and Florida. An Omnikom company." |
| `/contact` | src/routes/contact.tsx | Contact form + side notes | none | `Contact` / "Write to Matter of Place about a property, a market, or presenting a residence." |
| `/faq` | src/routes/faq.tsx | FAQ | data/faq.ts | `FAQ` / "Short answers about Matter of Place: what we feature, what it costs, who receives inquiries."; JSON-LD FAQPage |
| `/legal` | src/routes/legal.tsx | Notices, privacy, terms | none | `Legal` / "Illustrative-content notice, representation, editorial independence, privacy and terms for Matter of Place." |
| `/sitemap.xml` | src/routes/sitemap[.]xml.ts | XML sitemap (server GET handler) | services.catalog listProperties, listMarkets, listStories | none |

URL count: 20 URLs indexed (home, properties, property, markets, markets splat redirect, $market, guide, region, stories, story, place-notes redirect, editorial-standard, submit, exposure, pricing redirect, about, contact, faq, legal, sitemap.xml). Root layout and the three layout-only files (markets.tsx, $market.tsx, stories.tsx, Outlet only) are not counted.

Note on the home title: `pageHead` only skips the suffix when the title already ends with ` | Matter of Place`. The home title is `Matter of Place | Exceptional property. Properly considered.` which does not end with the suffix, so the rendered title is `Matter of Place | Exceptional property. Properly considered. | Matter of Place`. (Derived by reading seo.ts; not rendered in a browser.)

Sitemap static paths in code: `/`, `/properties`, `/markets`, `/stories`, `/editorial-standard`, `/submit`, `/exposure`, `/about`, `/contact`, `/faq`, `/legal`; plus `/{market}`, `/{market}/guide`, `/{market}/{region}` for every market/region, `/property/{slug}` (lastmod = publishedAt) and `/stories/{slug}` (lastmod = publishedAt).

### Redirects (all 301)

| From | To | Where |
|---|---|---|
| `/pricing` | `/exposure` | src/routes/pricing.tsx (comment: "Prices live on Property Exposure; this address stays valid for old links.") |
| `/place-notes` | `/stories` | src/routes/place-notes.tsx (comment: "Place Notes became Stories; the old address stays valid.") |
| `/markets/<anything>` | `/<anything>` (e.g. `/markets/california` -> `/california`) | src/routes/markets.$.tsx (comment: "Old /markets/<desk>/... addresses move to /<desk>/...") |
| `/$market/san-diego` | `/$market/la-jolla` | src/routes/$market.$region.tsx legacyRegions |
| `/$market/south-florida` | `/$market/fort-lauderdale` | src/routes/$market.$region.tsx legacyRegions |

Note: `/markets` (exact) is NOT redirected; it renders the Markets index.

### Not-found and error pages (root)

NotFound (src/components/layout/not-found.tsx):
- Eyebrow: NOT FOUND
- H1: This place is not on our map.
- Body: The page may have moved, or it was never here. We cover California, Florida and New York.
- Links: Home -> `/`; Properties -> `/properties`; Markets -> `/markets`

RouteError (src/components/layout/route-error.tsx):
- Eyebrow: SOMETHING WENT WRONG
- H1: This page did not open as it should.
- Body: Try once more, or return home.
- Actions: Try again (button, invalidates router and resets); Home -> `/`

---

## 2. Page-by-page blocks

Shared small components referenced: `TextLink` (link with label), `PageIntro` (eyebrow, title, optional text; component source not read, props as passed), `SectionHeading` (eyebrow, title, optional action), `ContentTag` (label over photography; default `ILLUSTRATIVE`), `ImageHero` (image, eyebrow, title, optional tag/children).

### `/` Home (src/routes/index.tsx)

1. **Hero carousel** (aria-label "Selected properties"). Image alt `Illustrative residence in {property.city}`. ContentTag: `ILLUSTRATIVE PROPERTY`.
   - Eyebrow: `{CITY}, {STATE}` uppercase {data: properties.ts city, state}
   - H1: `{property.title}` {data: properties.ts title}
   - Sub line: `{property.style}` {data: properties.ts style}
   - CTA: "View property" -> `/property/{slug}`
   - Controls: buttons aria-label "Previous property" / "Next property"; counter `01 / NN` (padIndex).
   - Hero list = properties with heroRank, sorted by heroRank (src/lib/catalog.ts).
2. **Editorial statement.** Eyebrow: MATTER OF PLACE. H2: "Exceptional property. Properly considered." Body: "An editorial real-estate media platform for exceptional residential property across California, New York and Florida. We select, present and distribute places worth attention." CTAs: "Explore Properties" -> `/properties`; "Submit a Property" -> `/submit`.
3. **Featured.** Eyebrow: THE CURRENT EDIT. Title: "Selected properties". Action: "All properties" -> `/properties`. PropertyGrid of up to 6 featured properties {data: properties.ts featuredRank}.
4. **Markets feature.** Eyebrow: THREE MARKETS. Title: "One editorial point of view." MarketGrid of markets {data: markets.ts}.
5. **The idea.** Eyebrow: THE IDEA. H2: "Not every property needs more marketing. The right property needs better attention." Body: "We decide what deserves attention, frame it with editorial care, then extend it through owned and precision distribution."
6. **How it works.** Eyebrow: HOW IT WORKS. Title: "Four steps." (id how-heading). Numbered list (01-04):
   - Selected: "We review exceptional existing residential properties across California, New York and Florida."
   - Edited: "Every selected property is shaped through our editorial and visual standards."
   - Published: "The property receives a permanent place within Matter of Place."
   - Distributed: "Exposure products extend the story through social, email and precision programmatic media."
7. **Property exposure strip.** Eyebrow: PROPERTY EXPOSURE. Title: "Four ways in." Action: "View Property Exposure" -> `/exposure`. Four compact OfferCards {data: data/exposure.ts offerings: name, price, line, note}: see section on `/exposure` for values.
8. **Precision distribution.** Eyebrow: PRECISION DISTRIBUTION. H2: "Beyond owned media." Body: "Selected campaigns can extend beyond our editorial channels through targeted display, native, video, CTV and select digital out-of-home. Media from {programmatic.minimum}." -> "Media from $250." {data: data/exposure.ts programmatic.minimum}. CTA: "Explore Distribution" -> `/exposure`.
9. **Editorial standard.** Eyebrow: EDITORIAL STANDARD. H2: `{editorialQualities.join(". ")}.` = "Architecture. Design. Originality. Materiality. Setting. History. Craft. Sense of place." {data: data/exposure.ts editorialQualities}. CTA: "Read Our Editorial Standard" -> `/editorial-standard`.
10. **Submit band.** H2: "A property worth attention?" Body: "Matter of Place is reviewing residential properties across California, New York and Florida." CTA button: "Submit a Property" -> `/submit`.

### `/properties` (src/routes/properties.tsx)

1. PageIntro. Eyebrow: A CONSIDERED COLLECTION. Title: Properties. Text: "A quiet selection of places with something to say. Every property shown is illustrative."
2. **HomeFinder** (src/components/search/home-finder.tsx). Eyebrow: DESCRIBE IT. H2: "Tell us the home you have in mind." Textarea placeholder: "Type, architecture, light, setting, budget"; aria-label "Describe your ideal home". Button: "Find" (pending: "Finding"). Example chips: "A mid-century house with a garden and views, under $6M" / "Modern home by the water with a terrace" / "Something with original details in San Francisco". Results: count `{n} CLOSE MATCH/MATCHES`, list `{city} · {reasons}`; empty: "Nothing close yet. Try a place, a style or a feature." Error: t.forms.error / t.forms.invalid (see Strings).
3. **Collection.** SectionHeading eyebrow: `SEARCHING “{TERM}”` when a term exists, else "CALIFORNIA · FLORIDA · NEW YORK". Title: "All places" (when all shown) or "Your selection". Action button: `Filter ({n}) +/−` (toggles filters). Search input placeholder "Search place, neighbourhood or property" (aria-label "Search properties"); button "Clear search". Filter panel (FilterBar). Result count `{n} PROPERTY/PROPERTIES`. Empty: "No properties match." + button "Clear filters".
   - FilterBar (src/components/filters/filter-bar.tsx): placeholder "Search place or property"; selects with aria-labels and first options: Market ("All markets"), Location ("All locations"), Maximum asking price ("Any price"; ceilings "Under $5M", "Under $7M", "Under $10M", "Under $15M"), Property type ("All types"), Bedrooms ("Any bedrooms"), Architectural style ("All styles"), Design feature ("All features"), Status ("All statuses").
   - QuickFilters (used in FilteredCollection): Property type ("Type"), Architecture ("Architecture"), Design feature ("Features").

### `/property/$slug` (src/routes/property.$slug.tsx)

All property-specific text comes from src/data/properties.ts fields noted.
1. **ImageHero.** Alt `Illustrative architecture in {city}`. Eyebrow `{CITY}, {STATE}`; Title `{title}`; Tag `ILLUSTRATIVE PROPERTY`; child line `{formatPrice(property)}` {data: properties.ts price, currency}; scrolls to `#dossier`.
2. **Dossier toolbar.** Breadcrumb: Home -> `/`; Markets -> `/markets`; `{market.name}` -> `/{market}`; `{region.name}` -> `/{market}/{region}`. Buttons: "Save" / "Saved" (aria-pressed); "Share" / "Link copied".
3. **DossierFacts** (src/components/property/dossier-facts.tsx): values with labels "Bedrooms", "Bathrooms", "Sq ft", "Acres", "Built".
4. **The residence.** Eyebrow: THE RESIDENCE. H2: "The property". Body: paragraphs from `property.story[]`. Closing eyebrow: `{TYPE} · {STYLE} · {STATUS}` uppercase.
5. **Gallery** (src/components/property/gallery.tsx). aria-label `Photography of the {city} property`. Images alt `{image.alt}, illustrative`, figcaption `{image.alt}`. Optional film: poster alt `{caption}, poster frame`; play button aria-label "Play property film", label `Play film · {video.duration}`, caption `{video.caption}`; video aria-label `{caption}, illustrative film of the {city} property`.
6. **Details.** Eyebrow: DETAILS. H2: "In particular". Bulleted `property.features[]`. Definition list: Type, Architecture, Year, Lot (`{lotAcres} acres`), Interior (`{n} sq ft`), Address, Status, Currency.
7. **Place.** Eyebrow: LOCATION & CONTEXT. H2: "The place". Sub-eyebrow `{CITY}, {STATE}`. Body `{property.place}`. If neighborhood differs from city: `{neighborhood} · {region.name}`. PlaceMap label `Approximate location of {city}`; note "Approximate location. Exact placement is shown for live listings only." CTA: `Explore {region.name}` -> `/{market}/{region}`.
8. **Representation** (src/components/property/representation.tsx). Eyebrow: REPRESENTATION. H2: "Represented by". If representation: name, brokerage, licence. Otherwise: "No brokerage is attached to this illustrative property. Matter of Place is not the listing brokerage; on live listings the representative, brokerage and licence appear here." Buttons: "Contact listing representative" (opens inquiry `agent`); "Request a private showing" (opens `showing`). Planned (B3 invariant 22, S55): for a home its owner submitted (`presentedByOwner`), H2 "Presented by the owner" with no name, brokerage or licence, and the first button reads "Contact the owner"; this is the CTO's default listed for the operator in ASSUMED H30 (7).
9. **InquiryBlock.** Eyebrow: INQUIRE. Title: "Begin a conversation." Text: "Every inquiry is read by a person and routed to the right representation." Buttons: "Request a private showing" (showing); "Ask about this property" (ask); "Find something similar" (similar); "I need to sell first" (sell); "I'm buying as an investment" (invest).
10. **ShareCover** (src/components/property/share-cover.tsx). Eyebrow: PRESERVE & SHARE. Card: wordmark, image, `{CITY}, {STATE}`, price, `{beds} BD · {baths} BA · {sqft} SQ FT`. Button: "Share property cover" / "Link copied".
11. **Related** (if any). Eyebrow: CONTINUE EXPLORING. Title: `More in {market.name}`. Action: "All properties" -> `/properties`.
12. **StickyActions** (phones). Buttons: "REQUEST SHOWING", "ASK" (t.common uppercased). aria-label "Property actions".
13. **AskMatterOfPlace** (concierge). Toggle button: "ASK MATTER OF PLACE". Panel aria-label "Ask Matter of Place"; eyebrow ASK MATTER OF PLACE; lede "Ask about this property."; suggested questions: "Is the property still available?", "Can I request a private showing?", "Are there similar properties nearby?", "Can you send the full details?"; pending text "One moment."; failure text = t.forms.error; answer text and link come from `services.concierge.answer` (service, not in scanned files); action button "Request a showing" when answer.action = showing; close aria-label "Close".
14. **InquiryDialog** opened per intent: see Forms section.

### `/markets` (src/routes/markets.index.tsx)

1. PageIntro. Eyebrow: THREE EDITORIAL DESKS. Title: Markets. Text: "Three markets. One editorial point of view."
2. MarketGrid of markets {data: data/markets.ts}.

### `/$market` (src/routes/$market.index.tsx). Valid markets in data: `california`, `florida`, `new-york`.

1. **ImageHero.** Alt `Illustrative property in {market.name}`. Eyebrow: "MATTER OF PLACE · EDITORIAL DESK". Title `{market.name}`. Image {data: markets.ts image}.
2. **The place.** Eyebrow: THE PLACE. H2: "Setting first." Body `{market.intro}` {data: markets.ts intro}. Sub-block eyebrow "PLACES WE FOLLOW", text `{market.places joined " · "}`.
3. **Market notes.** Eyebrow `HOW WE READ {MARKET NAME}`. Definition list of `market.notes[]` (label, text) {data: markets.ts notes}. CTA: `Read the {market.name} guide` -> `/{market}/guide`.
4. **Regions.** Eyebrow: REGIONS. Title `Within {market.name}`. Cards: `{count} PROPERTY/PROPERTIES`, `{region.name}`, `{region.places joined " · "}` -> `/{market}/{region}`.
5. **FilteredCollection.** Eyebrow: EXPLORE THE MARKET. Title: "Selected properties". Tabs: "All" (selected) + each region name. Collection UI: button `More +/−`, count `{n} PROPERTY/PROPERTIES`, empty text "Nothing here yet." + button (label in collection.tsx, clears filters).
6. **Recent additions** (if any). Eyebrow: RECENT ADDITIONS. Title `New to {market.name}`. 2 newest by publishedAt.
7. **Stories** (if any). Eyebrow: FROM THE DESK. Title `Stories from {market.name}`. Action: "All stories" -> `/stories`. Up to 3 stories for that market.

### `/$market/guide` (src/routes/$market.guide.tsx)

1. ImageHero. Alt `Illustrative {market.name} architecture`. Eyebrow: GUIDE. Title `{market.name}`.
2. Eyebrow NEIGHBORHOODS. Per region with entries: link `{region.name}` with arrow -> `/{market}/{region}`; definition list of `market.guide.neighborhoods[]` (name, text) {data: markets.ts guide.neighborhoods}.
3. Eyebrow "WHAT CLIENTS ASK OF US". Definition list `market.guide.needs[]` (label, text).
4. Eyebrow "HOW WE WORK HERE". Definition list `market.guide.service[]`. Links: `Properties in {market.name}` -> `/{market}`; "Submit a property" -> `/submit`.

### `/$market/$region` (src/routes/$market.$region.tsx)

1. ImageHero. Alt `Illustrative architecture in {region.name}`. Eyebrow `{MARKET NAME}, {COUNTRY}` uppercase (e.g. CALIFORNIA, UNITED STATES). Title `{region.name}`.
2. **The place.** Eyebrow: THE PLACE. H2 `{region.intro}` {data: markets.ts regions[].intro}. Body: `Part of the {market.name} market. We follow {places joined with commas and "and"}.` Chips: each place (aria-label "Places within this region").
3. **FilteredCollection.** Eyebrow: REGION COLLECTION. Title `Properties in {region.name}`. Tabs: "All" -> `/{market}`; each region (selected on current). Empty action: `See all of {market.name}` -> `/{market}`.
4. **Elsewhere** (if any). Eyebrow `ELSEWHERE IN {MARKET NAME}`. Title `Beyond {region.name}`. Action `All of {market.name}` -> `/{market}`. 2 properties from other regions.

### `/stories` (src/routes/stories.index.tsx)

1. PageIntro. Eyebrow: ARCHITECTURE · INTERIORS · PLACES. Title: Stories. Text: "Original writing from three editorial desks. Sample stories, shown to set the format."
2. StoryGrid {data: data/stories.ts}.
3. Newsletter (source "stories"): see Global chrome.

### `/stories/$slug` (src/routes/stories.$slug.tsx)

1. ImageHero. Alt empty. Eyebrow `{CATEGORY} · ILLUSTRATIVE STORY`. Title `{story.title}`.
2. Article: deck `{story.deck}`, then `story.body[]` paragraphs {data: stories.ts}.
3. Related (if any). Eyebrow: IN THIS STORY. Title: "The properties". Action: "All stories" -> `/stories`.

### `/editorial-standard` (src/routes/editorial-standard.tsx)

1. PageIntro. Eyebrow: EDITORIAL STANDARD. Title: "What we look for." Text: "A property's price does not decide whether it belongs here."
2. List: Architecture; Design; Originality; Materiality; Setting; History; Craft; Sense of place {data: data/exposure.ts editorialQualities}.
3. H2 "Selected, not bought". P1: "A thoughtful two million dollar house may deserve more attention than a generic twenty million dollar one. We read every submission for what it is." P2: "Every property is reviewed against this standard. Payment does not override selection. If a property is not accepted, nothing is charged."
4. H2 "What we cover". P: "Existing residential property in California, New York and Florida. Not every property in those places qualifies." CTA: "Submit a Property" -> `/submit`.

### `/submit` (src/routes/submit.tsx)

1. PageIntro. Eyebrow: FOR AGENTS, TEAMS & BROKERAGES (planned, B3 invariant 22, S55: FOR AGENTS, BROKERAGES & OWNERS). Title: Submit a Property. Text: "Submitted as you would submit work to a publication. Every property is reviewed before anything else happens."
2. SubmitWizard (see Forms).

### `/exposure` (src/routes/exposure.tsx)

1. PageIntro. Eyebrow: PROPERTY EXPOSURE. Title: "Exceptional properties deserve context." Text: "Editorial presentation, carried further through owned and precision-distribution channels."
2. **Products.** Label: "Products · USD". OfferCard per offering {data: data/exposure.ts offerings}. Card layout: optional flag "Recommended" (for recommended:true), name, price, line, optional note, bullet items, CTA link -> `/submit`.
   - **The Feature** $295. Line: "Editorial presence." Items: Dedicated Matter of Place property page; Professionally edited editorial narrative; Architecture, design and location context; Curated image sequencing; Matter of Place social carousel; Collaborator invitation where applicable; Agent or brokerage attribution; Direct inquiry routing; Search-indexable permanent URL; Placement in the California, New York or Florida collection. CTA: "Submit a Property".
   - **The Reach** $695 (Recommended). Line: "Editorial presence, expanded through precision distribution." Items: Everything in The Feature; Matter of Place Stories; Newsletter inclusion; Priority editorial scheduling; Homepage or market-page rotation; Additional social distribution; Programmatic campaign planning; Audience-targeting setup; Campaign reporting framework; Option to add programmatic media spend. CTA: "Expand the Reach".
   - **The Campaign** $1,495. Line: "A deeper, multi-channel property campaign." Note: "Recommended media investment: $500 to $2,500+". Items: Everything in The Reach; Deeper editorial research and an expanded property story; Multi-post editorial treatment; Short-form video or reel from supplied assets; Standalone property email; Priority homepage positioning; A 10 to 14 day campaign window; Multiple creative variants where appropriate; Programmatic media and retargeting strategy; Campaign optimization and post-campaign reporting. CTA: "Build a Campaign".
   - **Five Features** $1,250. Line: "For agents, teams and brokerages with several qualifying properties." Note: "$250 per property". Items: Five Feature credits; No expiration during the initial launch period; Submit properties individually; Every property remains subject to editorial approval; Declined properties do not use a credit; Distribution upgrades available per property. CTA: "Secure Five Features".
3. **Precision distribution.** Label: "Precision distribution". H2: "Beyond the post." P: "A remarkable property should not depend on an algorithm finding the right person by accident. Selected campaigns can extend beyond our own audience through targeted media on premium inventory." Definition list {data: data/exposure.ts programmatic}: "Programmatic media From $250" / "Billed separately from editorial products."; "Management 15% of media spend" / "$100 minimum management fee."; "Formats" / "Premium display · Native · Online video · Retargeting · CTV · Select DOOH". P: "Channel selection varies by campaign: the property, location, audience, objective, budget and available creative."
4. **How selection works.** Label: "How selection works". H2: "Review comes before payment." Numbered {data: data/exposure.ts selectionSteps}: 01 Submission "You send the property and its story."; 02 Editorial review "We read it against our editorial standard."; 03 Acceptance "Selected properties are confirmed. Others are not charged."; 04 Exposure "You choose the product that suits the property."; 05 Publication "The property receives its permanent place."; 06 Distribution "The story travels through owned and paid channels."
5. **FAQ** (label "FAQ"; expandable items with "+") {data: data/exposure.ts exposureFaq}:
   - Does paying guarantee acceptance? / No. Every property is subject to the Matter of Place editorial standard.
   - Do you guarantee buyers or leads? / No. Matter of Place provides editorial exposure and media distribution, not transaction guarantees.
   - Can I submit properties outside California, New York or Florida? / Not currently.
   - Do you work with new developments? / Not currently. Matter of Place is focused on existing residential property.
   - Is paid media included? / No. Programmatic media budgets are separate from editorial product fees.
   - Can agents purchase multiple Features? / Yes. Five Feature credits are available for $1,250.
   - Can a property remain discreet? / Yes. Sensitive property details can be handled discreetly where appropriate.
6. **Closing.** P: "Matter of Place provides attention, presentation and distribution. It does not guarantee buyers, inquiries or transactions." CTA: "Submit a Property" -> `/submit`.

### `/about` (src/routes/about.tsx)

1. PageIntro. Eyebrow: ABOUT. Title: "Real estate is not simply inventory."
2. Intro: P1 "A property can carry architecture, memory, landscape, design, craft and culture. Matter of Place exists to find those places, present them with care, and give them the attention they deserve." P2 "Today we focus only on California, New York and Florida, and only on existing residential property. We are intentionally narrow." P3 "Our ambition is not to publish everything. It is to build a meaningful point of view on the properties, people, architecture and places shaping three of America's most significant residential markets."
3. H2 "What we do": "We curate it. We frame it. We publish it. We distribute it." / "Editorial authority decides what deserves attention. Precision distribution decides how far that attention travels."
4. H2 "What we do not do": "We are not a brokerage and do not represent anyone in a sale. We do not sell leads or guarantee buyers. We do not publish everything we receive."
5. H2 "An Omnikom company": "Omnikom provides the media and distribution infrastructure beneath the platform. Matter of Place owns the editorial point of view."
6. Footer: "Exceptional property. Properly considered." CTA: "Explore Properties" -> `/properties`.

### `/contact` (src/routes/contact.tsx)

1. PageIntro. Eyebrow: A CONVERSATION. Title: Contact. Text: "Every message is read by a person. Tell us what you are looking for, or what you would like to present."
2. ContactForm (see Forms).
3. Aside, three blocks:
   - Eyebrow PROPERTY SEEKERS. H3 "Ask about a place." P: "Each property page has its own inquiry paths: private showings, questions, similar properties, and selling first. Start there if you have a specific house in mind." Link "Browse properties" -> `/properties`.
   - Eyebrow "OWNERS, AGENTS & DEVELOPERS". H3 "Present a property." P: "Submissions go through a short guided form. Every property is reviewed before a paid feature or campaign is agreed." Link "Submit a property" -> `/submit`.
   - Eyebrow MARKETS. H3 "California, Florida and New York." P: "Three markets, read closely, each with its own guide." Then, only if siteConfig.contact.email or phone is set: mailto/tel links. Both are null in src/config/site.ts, so currently nothing renders.

### `/faq` (src/routes/faq.tsx)

1. PageIntro. Eyebrow: FAQ. Title: "Asked often."
2. Expandable Q/A {data: data/faq.ts faq}:
   - What is Matter of Place? / An editorial real-estate media platform for exceptional existing residential property in California, New York and Florida.
   - How does a property get featured? / We find it, or it's sent to us. We research the house, write the story and choose the photographs. Few make it.
   - What are you looking for? / A reason to stop. A named architect, a considered interior, a house true to its place. Price is not the filter.
   - Can I submit a property? / Yes. We reply either way, and a no is not a verdict on the home.
   - Do I have to pay to submit a property? / No. Submission is free. Exposure products apply only after a property is accepted; payment does not override selection.
   - What if my property is not accepted? / Nothing is charged. With Five Features, a declined property does not use a credit.
   - What does it cost? / The Feature $295, The Reach $695, The Campaign $1,495, or Five Features for $1,250. Programmatic media is billed separately.
   - Who receives my inquiry? / The representative named on the property, directly. We never sell or share your details.
   - Are you a brokerage? / No. We represent no one in a sale and guarantee no buyers. Every property credits its representative.
   - Where do you cover? / California, New York and Florida only. We do not currently cover new developments.
   - Is there a newsletter? / Place Notes: selected properties and stories, sent when there is something worth sending.
   - How accurate are the details? / Specifications come from the listing; history comes from our research. Spot an error? Tell us.
3. Closing: "Still wondering? " + link "Write to us" -> `/contact`.

### `/legal` (src/routes/legal.tsx)

1. PageIntro. Eyebrow: NOTICES. Title: Legal. Text: "Plain statements about what this site is, what it is not, and how information is treated."
2. H2 "Illustrative content": "Every property, story, price, representative reference and photograph on this site is fictional and illustrative. Nothing shown is offered for sale or rent. Addresses are withheld or invented; any resemblance to a real property is coincidental."
3. H2 "Representation": "Matter of Place is a property publication and amplification service. It is not a real-estate brokerage and does not represent buyers or sellers. Live listings show the listing agent, brokerage and licence clearly on each property page, and inquiries are routed to that representation."
4. H2 "Editorial independence": "Editorial consideration is free and cannot be purchased. Paid packages amplify properties that have already been accepted editorially; they do not influence whether a property is accepted."
5. Privacy (id `privacy`). Eyebrow PRIVACY. H2 "Information we collect". P1: "Forms on this site collect what you type into them: your name, contact details, your message, and, for submissions, information about the property. We use it to answer inquiries, review submissions and send Place Notes to those who ask for it. We keep it for as long as the conversation or the review is open, and we remove it on request." P2: "Interaction events (pages viewed, filters used, inquiries started) are recorded to understand how the site is used and to attribute inquiries to the right property. We never sell or share personal details." P3, shown only when `!isLive`: "Delivery is not yet connected on this site: nothing entered into a form leaves your device until it is."
6. Terms (id `terms`). Eyebrow TERMS. H2 "Use of this site". P: "The photography, texts and design of Matter of Place may not be reproduced without permission. Property information is supplied by listing representatives and should be verified independently before any decision. Matter of Place accepts no liability for decisions made on the basis of illustrative content."
7. Company. Eyebrow COMPANY. H2 `{siteConfig.name}` = "Matter of Place". P: "Matter of Place is an Omnikom company." Then `{legal.entity}` and `{legal.address}` only if set (both null now). Link "Contact" -> `/contact`.

### `/sitemap.xml`
No visible copy; XML response, `cache-control: public, s-maxage=300, stale-while-revalidate=86400`.

---

## 3. Global chrome

### Header (src/components/layout/header.tsx, nav-links.ts, strings.ts `nav` and `header`)

- Brand link: aria-label "Matter of Place home" -> `/`; emblem plus wordmark text "Matter of Place".
- Left nav (aria-label "Main navigation"), primaryLinks:
  - Properties -> `/properties`
  - California -> `/california`
  - New York -> `/new-york`
  - Florida -> `/florida`
- Right nav (aria-label "Secondary navigation"), secondaryLinks:
  - Stories -> `/stories`
  - Property Exposure -> `/exposure`
  - About -> `/about`
  - CTA (class header-cta): "Submit a Property" -> `/submit`
  - Search icon button: aria-label and title "Search properties"
- Mobile: menu toggle aria-label "Open menu" / "Close menu"; separate mobile search button aria-label "Search properties".
- Header is transparent over the home hero; solid elsewhere; closes menu and search on route change.

### Menu panel (mobile, src/components/layout/menu-panel.tsx)

- dialog aria-label "Menu"; nav aria-label "Mobile navigation".
- Items in order: Properties, California, New York, Florida, Stories, Property Exposure, About, Submit a Property (same links as above), then button "Search properties".
- Tagline under menu: "Exceptional property. Properly considered."

### Search overlay (src/components/layout/search-overlay.tsx)

- dialog aria-label "Search properties".
- Eyebrow: FIND A PLACE
- Close button aria-label: "Close search"
- Input placeholder: "Where would you like to look?"; aria-label "Search location or property"
- Submit arrow aria-label: "Search properties"
- Footnote line: "California · New York · Florida"
- Behavior: submits to `/properties` with `?q=<term>` (or none if empty).

### Footer (src/components/layout/footer.tsx)

- Brand link (aria-label "Matter of Place home" -> `/`) with emblem and "Matter of Place".
- Statement (strings.footer.statement): "Matter of Place is an independent real-estate media and distribution platform focused on exceptional residential property in California, New York and Florida."
- Columns:
  - **Matter of Place** (strings footer.groups.place): Properties `/properties`; California `/california`; New York `/new-york`; Florida `/florida`.
  - **Editorial**: Stories `/stories`; Editorial Standard `/editorial-standard`; About `/about`.
  - **For Professionals**: Property Exposure `/exposure`; Submit a Property `/submit`; FAQ `/faq`.
  - **Company**: Contact `/contact`; Privacy `/legal#privacy`; Terms `/legal#terms`; Instagram (external, new tab) only when `siteConfig.social.instagram` (env VITE_INSTAGRAM_URL) is set.
- Bottom line left: "Matter of Place · An Omnikom company."
- Bottom line right: "© {current year} Matter of Place"

### Newsletter block (src/components/site/newsletter.tsx + newsletter-form.tsx)

Used on `/stories` with `source="stories"` (only place `<Newsletter>` appears in the scanned routes). Section id `place-notes`.
- Eyebrow: A NOTE FROM US
- H2: Place Notes
- Text: "Selected properties and stories from California, New York and Florida."
- Form: email input (placeholder and aria-label "Email address", required); button "Subscribe" (pending "Sending").
- Success (role status): local mode "Thank you. Place Notes opens with the live service; your address stays with you for now."; live mode "Thank you. Place Notes will reach you when the next letter is ready."
- Error: see Forms.

### Brand statement lines (verbatim, where each appears)

- "Exceptional property. Properly considered." : siteConfig.tagline; strings.header.tagline (menu panel); home statement H2; home title; about closing line.
- "An editorial real-estate media platform for exceptional residential property in California, New York and Florida." : siteConfig.description (home meta description).
- "Matter of Place is an independent real-estate media and distribution platform focused on exceptional residential property in California, New York and Florida." : footer statement.
- "An Omnikom company." : strings.footer.line.

### Illustrative-content notices (where the text lives)

- Legal page: "Every property, story, price, representative reference and photograph on this site is fictional and illustrative. Nothing shown is offered for sale or rent. Addresses are withheld or invented; any resemblance to a real property is coincidental."
- Labels over photography: `ILLUSTRATIVE` (strings.common.illustrative, default of ContentTag); `ILLUSTRATIVE IMAGERY` (strings.common.illustrativeImagery, defined; usage not found in scanned files); `ILLUSTRATIVE PROPERTY` (home hero ContentTag and property page ImageHero tag); `{CATEGORY} · ILLUSTRATIVE STORY` (story hero eyebrow).
- Properties page intro: "A quiet selection of places with something to say. Every property shown is illustrative."
- Stories page intro: "Original writing from three editorial desks. Sample stories, shown to set the format."
- Property page: image alts end ", illustrative"; PlaceMap note "Approximate location. Exact placement is shown for live listings only."; Representation note (see above).
- Data file header comments (not user-visible): properties.ts "Every entry is fictional and labelled as such in the interface"; stories.ts "Written to show the format, not reporting."

---

## 4. Forms

Shared: `Field` = label text above a control. `FormError` shows the message with role alert. `DeliveryNotice` shows `strings.forms.localNotice` only when not live (`isLive = services.mode === "live"`, src/services/index.ts); renders nothing when live. `SentNotice`: eyebrow "A QUIET NOTE", H2 title (default "Thank you."), text, optional button. Confirmation text = `sentText()` (src/lib/form-copy.ts) = liveSent if live else localSent. Error message logic (src/hooks/use-async-action.ts): validation error (ZodError or ServiceError kind "validation") -> `strings.forms.invalid`; anything else -> `strings.forms.error`. There are no per-field validation messages in the UI; native HTML `required` attributes apply and the schema errors collapse to the one message.

### 4.1 Newsletter form
- Field: Email address (type email, required, autocomplete email; placeholder "Email address").
- Button: Subscribe / Sending.
- Success: newsletter.localSent or newsletter.liveSent (see Section 3).
- Error: "This did not go through. Please try once more." or "Please check the highlighted details."
- Event: newsletter_signup.

### 4.2 Contact form (src/components/forms/contact-form.tsx, at `/contact`)
- Eyebrow: WHAT IS THIS ABOUT? ChoiceGroup (aria-label "Inquiry type"), default first option. Options {data: src/domain/contracts.ts contactTopics}: General inquiry; About a property; Selling or presenting a property; Property Exposure; Press and partnerships.
- Fields: "Your name" (required), "Email" (required), "Phone (optional)", "Where are you based?" (placeholder "City, country"), "Message" (textarea, 5 rows, required).
- Button: Send / Sending.
- Success (SentNotice, default title "Thank you."): sentText(); button "Write another".
- Error/notice: FormError; DeliveryNotice: "Delivery opens with the live service. Until then, nothing leaves this device."
- Sent to `services.inquiries.send` with intent "general", topic, sourcePath. Event: contact_inquiry.

### 4.3 Inquiry dialog (src/components/forms/inquiry-dialog.tsx, property pages)
Structure: overlay dialog; eyebrow (per intent); close button aria-label "Close"; subject line = property title + city (e.g. `{property.title} {property.city}`); H2 title; lede; fields; actions "Send"/"Sending" and "Cancel". Common fields: "Your name" (required), "Email" (required), "Phone (optional)", then intent extras, then "Message" (textarea 4 rows, required, prefilled with intent default message). Success: SentNotice with title "Thank you." (default), sentText(), button "Close". Error/notice as above.

Per intent (copy verbatim):
- **showing** — Eyebrow: REQUEST A PRIVATE SHOWING. Title: "Arrange a visit." Lede: "Tell us when you would like to see the property. The listing representative will confirm directly." Message prefill: "I would like to arrange a private showing." Extra: "Preferred timing" (placeholder "e.g. weekday mornings, or a specific date"). Event: showing_request.
- **ask** — Eyebrow: ASK ABOUT THIS PROPERTY. Title: "Ask us anything." Lede: "A short question is enough. We answer personally." Message prefill: (empty). Event: property_inquiry.
- **similar** — Eyebrow: FIND SOMETHING SIMILAR. Title: "Tell us what you are looking for." Lede: "Describe the setting, budget and character you have in mind and we will suggest places with something in common." Message prefill: "I am looking for something similar to this property." Extras: "Budget" (placeholder "e.g. up to $8M"); "Places you would consider" (placeholder "e.g. Marin, Palm Beach, anywhere with water"). Event: similar_property_request.
- **sell** — Eyebrow: I NEED TO SELL FIRST. Title: "Let us start with your current home." Lede: "Tell us a little about the property you would be selling. We will connect you with the right representation." Message prefill: "I am interested in this property but would need to sell first." Extra: "Your current property" (placeholder "City or neighbourhood, and the kind of house"). Event: seller_intent.
- **invest** — Eyebrow: BUYING AS AN INVESTMENT. Title: "Tell us about your intentions." Lede: "Rental, long-term hold, or a residence used part of the year: the answer shapes what we suggest." Message prefill: "I am considering this property as an investment." Extra: "Intended use and horizon" (placeholder "e.g. seasonal rental, ten-year hold"). Event: investment_intent.
- **agent** — Eyebrow: CONTACT LISTING REPRESENTATIVE. Title: "Reach the representative." Lede: "Your message goes to the listing representative. Matter of Place is not the listing brokerage." Message prefill: (empty). Event: agent_contact. Planned (B3, S55): opened from a home its owner submitted, eyebrow CONTACT THE OWNER, title "Reach the owner.", lede "Your message goes to the owner of this home. Matter of Place is not a brokerage."; the message also reaches the person who submitted the property by email (B5 `inquiry_forward`).
- **general** — Eyebrow: GENERAL INQUIRY. Title: "Write to us." Lede: "Questions about properties, markets, or presenting a property with Matter of Place." Message prefill: (empty). Event: contact_inquiry. (Defined in copy; the property page never opens it; the contact page uses ContactForm.)

### 4.4 Submit wizard (src/components/forms/submit/wizard.tsx, steps.tsx, state.ts)
Progress list (numbered): 01 Property, 02 The story, 03 Representation, 04 Exposure, 05 Review (planned, B3 invariant 22, S55: 03 About you). Buttons: "Back" (from step 2), "Continue" (steps 1-4, disabled until the step is valid), final step "Send for review" (pending "Sending"). FormError and, on the last step only, DeliveryNotice.

Continue-gating rules (state.ts canContinue): step 1 requires address, city, a state that is one of the three accepted (not "Another state"), a 5-digit ZIP, and a property type. Step 2 requires story and significance text. Step 3 requires brokerage, agent name, agent email (planned, S55: a chosen "I am" kind, name and email, and a brokerage only for a real estate agent). Step 4 requires a chosen exposure package and the rights checkbox. Step 5 always allowed. No inline per-field messages besides the out-of-market notice.

**Step 1: The property**
- Fields: Property address; City; State (select, first option "Select state"; options California, New York, Florida, "Another state" {data: contracts.ts acceptedStates + state.ts otherState}); ZIP.
- Notice when "Another state" chosen (role status): "Matter of Place is currently accepting submissions from California, New York and Florida."
- Fields: Property type (select, first option "Select type"; options {data: contracts.ts propertyTypes}: Residence; Estate; Townhouse; Apartment; Penthouse; Waterfront; Farmhouse); Asking price (USD); Bedrooms; Bathrooms; Approximate square feet; Listing URL (placeholder "https://").
- Price preview when price > 0: "Shown as: {formatMoney(price, "USD")}".

**Step 2: The story**
- H2 "The story". Fields: Architect, if known; Designer, if known; Year built; Year renovated; The property story (textarea); What makes this property significant? (textarea); Photography link (placeholder "https://"); Video link (placeholder "https://").
- Photography upload: title "Photography"; hint "Or upload up to 20 high-resolution images." (maxFiles = 20); button "Choose files" / "Change selection"; file list with name and size in MB.

**Step 3: Representation** (today) and **About you** (planned, B3 invariant 22, operator decision S55)
- Today: H2 "Representation". Fields: Listing agent; Brokerage; Agent email; Agent phone; MLS or source link (placeholder "https://").
- Planned: H2 "About you". First field: select "I am" (required, placeholder "Select one", no default) with exactly two options, "Real estate agent" and "Property owner" {data: contracts.ts submitterKinds + submitterKindLabels}. Real estate agent: Your name; Brokerage (required); Email; Phone; MLS or source link (placeholder "https://"). Property owner: Your name; Email; Phone; no brokerage field; checkbox "This home is currently listed with an agent", which when ticked shows Listing agent name and Listing agent brokerage (both optional). Contract fields `submitterKind`, `submitterName`, `submitterEmail`, `submitterPhone`, `brokerage`, `listedWithAgent`, `listingAgentName`, `listingAgentBrokerage`.

**Step 4: Preferred exposure**
- H2 "Preferred exposure". Lede: "Confirmed only after editorial review. Nothing is charged now."
- ChoiceGroup "Preferred exposure" options {data: contracts.ts exposurePackages}: The Feature; The Reach; The Campaign; Five Features; Not sure yet.
- Field: Optional media budget (USD).
- Checkbox: "I confirm I have the rights to share this property's photography and media." (unchanged for both kinds: an owner and an agent confirm the same thing about the photographs, S55)
- Link: "Compare Property Exposure" -> `/exposure` (fires package_interest with package "submit_compare").

**Step 5: Review**
- H2 "Review". Definition list rows: Address; Type; Price; Architect; Photography; Representation (planned, S55: "Submitted by", `<name>, <brokerage>` for an agent and `<name>, owner` for an owner, with `, listed with <listing agent name>` when given); Exposure; Media budget. Empty values show "Not stated". Photography row shows `{n} file(s) selected` or the photography URL.
- ReviewTimeline: Submit; Editorial review; Acceptance; Exposure; Publish; Distribute. Text: "Every property is reviewed against our editorial standard. Payment does not override selection. If a property is not accepted, nothing is charged."

**Outcome**
- Success (SentNotice): eyebrow "A QUIET NOTE"; H2 "Received. Editorial review comes next."; text = sentText(); button "Start again".
- Error: strings.forms.invalid / strings.forms.error. Notice: strings.forms.localNotice (not live).
- Event: submit_property.

### 4.5 Home finder and search inputs
Not submit forms, listed for completeness: Home finder textarea (see `/properties`), header search overlay (Section 3), properties page search input and filters. Home finder calls `services.search.match`.

---

## 5. Strings and notices

### src/lib/strings.ts (`en` table, exported via `t`; locale `en`, direction ltr)

**Navigation labels (`nav`)**
- properties: "Properties"
- california: "California"
- newYork: "New York"
- florida: "Florida"
- stories: "Stories"
- standard: "Editorial Standard"
- submit: "Submit a Property"
- about: "About"
- exposure: "Property Exposure"
- faq: "FAQ"
- contact: "Contact"
- privacy: "Privacy"
- terms: "Terms"
- instagram: "Instagram"

**Header (`header`)**
- home: "Matter of Place home"
- search: "Search properties"
- openMenu: "Open menu"
- closeMenu: "Close menu"
- closeSearch: "Close search"
- findAPlace: "FIND A PLACE"
- searchPlaceholder: "Where would you like to look?"
- searchLabel: "Search location or property"
- openMarkets: "California · New York · Florida"
- tagline: "Exceptional property. Properly considered."

**Footer (`footer`)**
- groups.place: "Matter of Place"
- groups.editorial: "Editorial"
- groups.professionals: "For Professionals"
- groups.company: "Company"
- statement: "Matter of Place is an independent real-estate media and distribution platform focused on exceptional residential property in California, New York and Florida."
- line: "An Omnikom company."

**Common (`common`)**
- illustrative: "ILLUSTRATIVE"
- illustrativeImagery: "ILLUSTRATIVE IMAGERY"
- exploreProperties: "Explore properties"
- subscribe: "Subscribe"
- emailAddress: "Email address"
- requestShowing: "Request showing"
- ask: "Ask"
- send: "Send"
- sending: "Sending"
- cancel: "Cancel"
- close: "Close"
- back: "Back"
- continue: "Continue"

**Form notices (`forms`)**
- thankYou: "Thank you."
- localNotice (comment: shown beneath every form while the API is not configured): "Delivery opens with the live service. Until then, nothing leaves this device."
- localSent (confirmation while the API is not configured): "Delivery opens with the live service, so this stays with you for now."
- liveSent (confirmation once the API is configured): "A person will reply within one working day."
- error: "This did not go through. Please try once more."
- invalid: "Please check the highlighted details."

**Newsletter (`newsletter`)**
- eyebrow: "A NOTE FROM US"
- title: "Place Notes"
- text: "Selected properties and stories from California, New York and Florida."
- localSent: "Thank you. Place Notes opens with the live service; your address stays with you for now."
- liveSent: "Thank you. Place Notes will reach you when the next letter is ready."

Other exports: `defaultLocale = "en"`, `localeDirection = { en: "ltr" }`, `t`. `getStrings()` is file-local since B1b step 2b (knip); `t` is the one export that uses it. Comment in the file: English is the only locale in V1, no language switcher; editorial copy in property and market data is authored per record and is not in this table.

### src/lib/form-copy.ts
- `sentText()` returns `t.forms.liveSent` when `isLive` is true, otherwise `t.forms.localSent`. It exports no literal strings of its own. So: live = "A person will reply within one working day."; local = "Delivery opens with the live service, so this stays with you for now."

### Related shared strings elsewhere (for reference)
- Filters and collection empty text: see `/properties` and `/$market`.
- `src/lib/seo.ts` unavailable-page head: title `{Noun} unavailable`, description `This {noun lowercased} could not be found.`, noindex.

---

## 6. Analytics events (src/lib/analytics.ts `AnalyticsEvent` union)

`track(event, data)` pushes to `window.dataLayer` always and to `{apiBaseUrl}/events` via `sendBeacon` when `siteConfig.apiBaseUrl` is set. Firing sites found by grep of `track(` and `useTrackView(` across src:

| Event | Fired by | Data payload |
|---|---|---|
| property_view | src/routes/property.$slug.tsx via useTrackView on mount / slug change | slug |
| gallery_engagement | src/components/property/gallery.tsx: first time gallery scrolls into view (30% threshold) `{slug}`; and when the film is played `{slug, media: "video"}` | slug, media |
| property_save | src/routes/property.$slug.tsx toggleSaved | slug, saved |
| share | src/routes/property.$slug.tsx share() | slug |
| showing_request | inquiry-dialog.tsx (intent showing, after send); concierge.tsx (question "Can I request a private showing?") | intent, subject; or slug, via "concierge" |
| property_inquiry | inquiry-dialog.tsx (intent ask, after send); concierge.tsx ("Is the property still available?" and "Can you send the full details?") | intent, subject; or slug, via "concierge" |
| similar_property_request | inquiry-dialog.tsx (intent similar); concierge.tsx ("Are there similar properties nearby?") | as above |
| seller_intent | inquiry-dialog.tsx (intent sell) | intent, subject |
| investment_intent | inquiry-dialog.tsx (intent invest) | intent, subject |
| agent_contact | inquiry-dialog.tsx (intent agent) | intent, subject |
| submit_property | src/components/forms/submit/wizard.tsx after successful send | state, package |
| package_interest | src/components/site/offer-card.tsx (CTA click, package = offering.id); src/components/forms/submit/steps.tsx ("Compare Property Exposure" link, package "submit_compare") | package |
| newsletter_signup | src/components/forms/newsletter-form.tsx after success | source |
| market_view | src/routes/$market.index.tsx (`{market}`); src/routes/$market.guide.tsx (`{market, page: "guide"}`) via useTrackView | market, page |
| region_view | src/routes/$market.$region.tsx via useTrackView | market, region |
| story_view | src/routes/stories.$slug.tsx via useTrackView | category |
| contact_inquiry | src/components/forms/contact-form.tsx after success; also inquiry-dialog.tsx `general` intent event mapping | topic |
| concierge_open | src/components/property/concierge.tsx openPanel | slug |
| filter_use | src/hooks/use-filters.ts (any filter key other than "term") | key, value |
| search | src/components/layout/search-overlay.tsx on submit `{term}`; src/routes/properties.tsx when `?q=` present `{q}` | term / q |
| home_finder | src/components/search/home-finder.tsx after a successful search with matches | q, matches |

All 21 union members have at least one firing site. Envelope: `{event, path, at, data}`; dataLayer entries are `{event, ...data, path, at}`.

---

## 7. Appendix: data-file content that renders on pages (source files, not edited)

Markets (`src/data/markets.ts`): three markets, slugs `california` (name California), `florida` (Florida), `new-york` (New York); country "United States"; each has `intro`, `places`, `notes[]` (label, text), `regions[]` (slug, name, intro, places), and `guide` (neighborhoods, needs, service). Full verbatim text is in the appendix file: `E:\Matter Of Place\workspace\01-site-index\appendix-data-copy.md` (generated with the same run).

Stories (`src/data/stories.ts`) slugs and titles: light-on-the-northern-side-of-the-bay "Light on the northern side of the bay." (Places, california); shade-as-a-material "Shade as a material." (Architecture, florida); the-brownstone-parlor "The brownstone parlor floor." (Interiors, new-york); courtyards-of-the-westside "Courtyards of the Westside." (Architecture, california); stone-houses-of-the-hudson "Stone houses of the Hudson." (Stories, new-york); palm-beach-without-the-postcard "Palm Beach, without the postcard." (Places, florida).

Properties (`src/data/properties.ts`): 16 property records (count of `id: "mop-..."`); the appendix lists id, slug, market, region, city, title, address, price, type, style and status per record. Story paragraphs, `place` text and `features` are in the source file only.
