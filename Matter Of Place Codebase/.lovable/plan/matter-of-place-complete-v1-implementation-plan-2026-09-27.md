# Matter of Place — Complete V1 implementation plan

## Source of truth
Use the uploaded **Matter of Place master website brief** in full and the uploaded **logo-system image** as the visual reference. The brief supplies the positioning, copy, page inventory, interactions, data fields, markets, and exclusions; the image supplies the five approved logo treatments (primary lockup, stacked and horizontal wordmarks, standalone threshold emblem, social avatar). The project currently opens to a placeholder, so this is a new website rather than a redesign of an existing one.

## Important dependency
The full requested version includes inquiry capture, property submissions with photography, newsletter signups, editorial management, analytics, and eventual Omnikom routing. These require persistent storage and server-side functionality. **Lovable Cloud is currently disabled for this user. Do not implement those services or substitute browser storage.** Before full implementation, enable Lovable Cloud in **Connectors → Lovable Cloud → Tool Permissions → Enable Lovable Cloud**, choosing **Always allow** or **Ask each time**, then request implementation again. Until then, a purely visual frontend prototype could be planned separately, but its forms must not pretend to submit or save information.

## Identity and experience
- Build an original, selective global property publication, not a brokerage, MLS portal, search-heavy marketplace, hotel site, or SaaS dashboard. Keep Omnikom attribution discreet in the footer.
- Recreate the supplied architectural threshold emblem and light geometric wordmarks as usable brand assets, preserving the primary, secondary, horizontal, standalone, and social variants. No roof, key, pin, or generic house mark.
- Use the exact supplied palette: Obsidian `#11110F`, Bone `#EEEAE1`, Warm Ivory `#F5F2EB`, Sandstone `#C9C0B2`, Mineral Grey `#575751`, Warm Grey `#8B877F`, and optional earth `#514B43`. Pair geometric sans utility type with a refined editorial serif; use photography for color. Avoid neon, gradients, glass effects, gold clichés, and artificial heavy textures.
- Keep navigation and movement quiet; make property imagery and place the first impression. Support keyboard and touch navigation, reduced motion, mobile-first viewing, fast image delivery, and accessible contrast and forms.

## Pages and journeys
1. **Home:** Property-led near-full-screen opening with 4–6 curated properties, restrained arrows and count, location, price, and one View Property action. Follow with the short editorial statement, 6–9 featured-property tiles, California and Florida destinations, and understated Place Notes signup.
2. **Properties and search:** Curated browsable collection with restrained search and optional location/price/type/bedroom/style/status filters; avoid a dense inventory portal.
3. **Markets:** California and Florida overview and populated market/region pages only. Lead with editorial imagery and brief context, then regional navigation and filtered property selections. Do not launch empty country pages; future geographies remain supported in the data model rather than presented as active inventory.
4. **Property dossier:** Large opening image, location/headline/price, sparse facts, specific editorial narrative, mixed-format gallery, the place, clearly credited representative and brokerage, availability/status, related properties, and mobile sticky Request Showing action. Provide Ask About This Property, Find Something Similar, I Need to Sell First, and investment inquiry paths. Concise Ask Matter of Place answers may use known property facts; do not misrepresent a scripted response as a live AI concierge.
5. **Developments:** Selective collection and rich project detail template, with story, location, architecture, residence types, developer attribution, availability, and inquiry.
6. **Submit a Property:** Full brief-specified agent/developer, property, listing, price, description, rights, status, service, and photography fields; clear distinction between independent editorial consideration and paid amplification. Implement validation, upload handling, and real submission only after Cloud is enabled.
7. **Property Exposure:** Feature, Amplify, Launch, and Development packages with only the brief's supported inclusions and a clear inquiry path; do not invent prices.
8. **About, Contact, Legal, and footer:** Restraint and concise place-first positioning, relevant contact/legal details supplied or clearly marked as needing confirmation, discreet Omnikom line, and Instagram only if a real destination is provided. No invented address, phone, license, or agent identity.

## Content and data
- Prepare at least 12 **clearly labeled fictional demonstration properties**: 4 Bay Area, 2 Southern California, 4 Florida, 2 future/global previews. Only the first 10 appear in active US market browsing; global previews remain explicitly illustrative, not active country pages. Do not invent real listing representatives or imply properties are on the market.
- Support the brief's complete property fields plus country/region/city/submarket, representatives and brokerages, developments, campaigns, availability, currency, language, editorial status, and media attribution. Format regional prices appropriately and keep English V1 copy ready for future localization.
- Use credible, varied property photography with usage rights; generated imagery must remain clearly illustrative and never be presented as a photograph of an actual listing. Use the supplied logo reference as the branding source, not as a property image.

## Services and management — after Cloud is enabled
- Persist property content, media references, submissions, newsletter consent, and structured inquiries securely; protect internal editorial management with authenticated, server-validated access and separate roles.
- Build a modest editorial workspace for adding/editing, review and approval, market and representative assignment, media, status, feature placement, package, publish state, and reporting. Respect the distinction between editorial selection and paid distribution.
- Record the specified analytics events and inquiry attribution. Prepare an Omnikom handoff boundary, but do not claim CRM integration or email delivery without actual credentials/integration and confirmation.
- Supply meaningful success/error states and consent handling for all forms. Do not expose private inquiries or submissions publicly.

## Technical and launch checks
- Implement in the existing TanStack Start app with reusable layouts and semantic design tokens. Use real leaf pages for each linked destination and clean URLs such as `/property/:slug`, `/markets/california`, `/developments/:slug`, and `/submit`.
- Give each content page a unique title, description, social metadata, and relevant structured data; do not use fabricated or placeholder social images. Optimize responsive imagery and lazy-load lower-page media.
- Verify desktop and mobile compositions, menu and hero controls, property/filter navigation, forms and validation, accessibility, missing-page states, and production build diagnostics. Clearly distinguish demo properties from real inventory before publication.

## Acceptance criteria
The first screen feels like a quiet private property publication; the supplied logo system is recognizable; active US markets and property stories are navigable; all commercial actions have honest, functional outcomes; no empty geography or fake brokerage claim appears; the website remains fast and legible on mobile. Full acceptance of capture, management, and analytics depends on Lovable Cloud being enabled.
