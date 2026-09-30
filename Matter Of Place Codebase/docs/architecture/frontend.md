# Frontend structure

## Folder map

```text
src/
  env.d.ts                     typed VITE_* variables
  router.tsx                   router factory with the QueryClient context
  (no start.ts / server.ts)    TanStack Start default entries; CSRF middleware installed by Start
  styles.css                   stylesheet entry: imports styles/*
  config/site.ts               name, URLs, contact and legal details (rendered only when present)
  domain/                      types + Zod contracts, no runtime dependencies besides zod
    property.ts market.ts story.ts exposure.ts contracts.ts index.ts
  data/                        illustrative content authored per record
    properties.ts markets.ts stories.ts exposure.ts faq.ts
  services/                    the boundary (see services.md)
    types.ts index.ts local/{catalog,outbox,search,concierge}.ts http/{client,index}.ts
  lib/
    catalog.ts                 formatPrice, propertiesIn, relatedProperties, featured/hero ranking
    format.ts                  numbers, money, plurals, padded indexes
    seo.ts                     pageHead(), unavailableHead(), JSON-LD helpers
    queries.ts                 TanStack Query options for every catalog read
    analytics.ts               typed track()
    strings.ts                 chrome strings and notices (single locale, ready for more)
    form-copy.ts               confirmation copy that depends on delivery mode
    cx.ts                      class-name joiner
  hooks/
    use-filters.ts             filter state + applyFilters()
    use-modal.ts               scroll lock + Escape for dialogs and menus
    use-async-action.ts        idle/pending/success/error for form submissions
    use-track-view.ts          one view event per entity
    use-scrolled.ts            header background switch
  components/
    brand/                     Emblem, Wordmark
    layout/                    Header, MenuPanel, SearchOverlay, Footer, NotFound, RouteError, nav links
    site/                      PageIntro, SectionHeading, ImageHero, ContentTag, cards, InquiryBlock,
                               PlaceMap, Breadcrumb, Newsletter, TextLink/TextButton
    forms/                     Field, ChoiceGroup, notices, NewsletterForm, ContactForm, InquiryDialog
      submit/                  wizard state, steps, SubmitWizard
    filters/                   FilterBar, QuickFilters, FilteredCollection
    property/                  DossierFacts, Gallery, Representation, ShareCover, AskMatterOfPlace, StickyActions
    search/                    HomeFinder (natural-language matcher UI)
  routes/                      see the inventory below
  styles/                      tokens, base, layout/, components/, pages/, motion
```

## Route inventory

| URL                                      | File                            | Data                        | Notes                                                                        |
| ---------------------------------------- | ------------------------------- | --------------------------- | ---------------------------------------------------------------------------- |
| `/`                                      | `routes/index.tsx`              | properties, markets         | Current edit, desks, idea, process, products, programmatic, standard, submit |
| `/properties`                            | `routes/properties.tsx`         | properties, markets         | Home finder, search, filters                                                 |
| `/property/$slug`                        | `routes/property.$slug.tsx`     | property, properties        | Dossier and inquiry paths                                                    |
| `/markets`                               | `routes/markets.index.tsx`      | markets                     | Three editorial desks                                                        |
| `/$market`                               | `routes/$market.index.tsx`      | market, properties, stories | California, New York, Florida desks                                          |
| `/$market/$region`                       | `routes/$market.$region.tsx`    | market, properties          | Region collection                                                            |
| `/$market/guide`                         | `routes/$market.guide.tsx`      | market                      | Neighbourhoods and local service                                             |
| `/stories`, `/stories/$slug`             | `routes/stories.*.tsx`          | stories                     | Editorial index and story                                                    |
| `/editorial-standard`                    | `routes/editorial-standard.tsx` | `data/exposure.ts`          | Selection criteria and review gate                                           |
| `/submit`                                | `routes/submit.tsx`             | none                        | Five-step submission, three states only                                      |
| `/exposure`                              | `routes/exposure.tsx`           | `data/exposure.ts`          | Four products, programmatic media, FAQ                                       |
| `/about`, `/contact`, `/faq`, `/legal`   | one file each                   | static / `data/*`           |                                                                              |
| `/pricing`, `/place-notes`, `/markets/*` | redirects                       | none                        | To `/exposure`, `/stories`, `/$market`                                       |

`routeTree.gen.ts` is generated by the Vite plugin; never edit it.

## Conventions

- **Loaders read through Query.** `loader: ({ context: { queryClient } }) => queryClient.ensureQueryData(propertiesQuery())`. Components read `Route.useLoaderData()`. Stale time is five minutes to match the edge cache.
- **Every route defines `head()`** through `pageHead()` in `lib/seo.ts`: title `"X | Matter of Place"`, description, Open Graph, Twitter card, canonical, optional JSON-LD. Routes with a loader use `unavailableHead()` when `loaderData` is missing.
- **Not found.** Dynamic routes throw `notFound()`; the root route renders `NotFound`.
- **Forms.** `useAsyncAction` wraps a service call; `FormError` shows a calm message; `SentNotice` replaces the form on success; `DeliveryNotice` explains local mode beneath the actions and disappears when the API is configured.
- **Analytics.** Call `track("event_name", data)` from event handlers. Add new names to `AnalyticsEvent`.
- **Styling.** Class names, no utility framework. Tokens in `styles/tokens.css`; add page rules to `styles/pages/<page>.css`. Sections set `padding-top`/`padding-bottom` only; width and side padding come from `.section-wrap`.
- **Copy.** Calm, brief, no em dashes. Illustrative content is always labelled as such.
- **Images.** Editorial photography is imported from `src/assets` so Vite fingerprints it. The API returns absolute URLs in the same fields.

## Adding a page

1. Create `src/routes/<name>.tsx` with `createFileRoute("/<name>")`, a `head()` and a component.
2. If it reads catalog data, add or reuse a query in `lib/queries.ts` and call it from the loader.
3. Add styles under `src/styles/pages/` and import the file from `src/styles.css`.
4. Link it from `components/layout/nav-links.ts` or the footer if it belongs in navigation.

## Local development against the API

```bash
cp .env.example .env
# VITE_API_BASE_URL=http://localhost:8787/api
npm run dev
```

With the variable set, `services.mode === "live"`: catalog reads hit the API, forms post to it, analytics beacons to `/events`, and the delivery notices disappear.
