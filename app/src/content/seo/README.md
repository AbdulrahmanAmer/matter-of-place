# Search pages

One file here is one public page: a collection guide at `/<slug>` or an article guide at `/guides/<slug>`. The shape is `types.ts`; the list of pages is `index.ts`; the copy rules are in the header of `types.ts`.

Add a guide (`/guides/<slug>`):

1. Copy `guides-how-to-sell-a-historic-home.ts`, rename it `guides-<slug>.ts` and write the page.
2. Import it in `index.ts` and add it to `seoPages`. Nothing else: the route `_site.guides.$slug.tsx`, the `/guides` index, the sitemap and the sweep read the list.

Add a collection guide (`/<slug>`): the same two steps with `historic-homes-for-sale.ts`, plus its route file `src/routes/_site.<slug>.tsx` (copy `_site.historic-homes-for-sale.tsx`, change the two paths), its line in `routeFileCoverage` of `tests/e2e/fixtures/routes.ts`, and `bun run build` to regenerate `src/routeTree.gen.ts` (GOTCHAS P-3734). `tests/unit/seo-pages.test.ts` fails with a clear message when one of these is missing.

Set `published` and `updated` to the real day: the sitemap `lastmod` and the JSON-LD dates are those fields, never the build clock.
