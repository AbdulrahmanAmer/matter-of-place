# Search pages

One file here is one public page: a collection guide at `/<slug>` or an article guide at `/guides/<slug>`. The shape is `types.ts`; the list of pages is `index.ts`, with two light lists beside it, `meta.ts` and `loaders.ts` (below); the copy rules are in the header of `types.ts`.

Add a guide (`/guides/<slug>`):

1. Copy `guides-how-to-sell-a-historic-home.ts`, rename it `guides-<slug>.ts` and write the page.
2. Import it in `index.ts` and add it to `seoPages`; add its line to `meta.ts` (address, kind, headline, description, as in the file) and, for a guide, its slug to `guideLoaders` in `loaders.ts`. The route `_site.guides.$slug.tsx`, the `/guides` index, the sitemap and the sweep read these lists.

Add a collection guide (`/<slug>`): the same steps with `historic-homes-for-sale.ts` (no line in `loaders.ts`), plus its route file `src/routes/_site.<slug>.tsx` (copy `_site.historic-homes-for-sale.tsx`, change the path, the file name in the `import(...)`, the exported name and the component name), its line in `routeFileCoverage` of `tests/e2e/fixtures/routes.ts`, and `bun run build` to regenerate `src/routeTree.gen.ts` (GOTCHAS P-3734). `tests/unit/seo-pages.test.ts` fails with a clear message when one of these is missing.

Every page declares its own `words: [low, high]` (what its brief asks for) and the test counts the page against it. The test tells the outline a page must follow by the heading of its closing section: "Get started" (money page: How it works / What you get / Proof: reviews and results), "Talk to Matter of Place" (city landing page: Why work with Matter of Place in X / How we help in X / X market and neighborhood facts / What it costs) or "Next step" (guide). A brief with a fourth outline adds it to `outlineProblems` in `tests/unit/seo-pages.test.ts`. A dollar figure or percentage on a page must also appear in `src/data/exposure.ts`.

Set `published` and `updated` to the real day: the sitemap `lastmod` and the JSON-LD dates are those fields, never the build clock.

Why the lists: a route file and everything it imports at the top is in the chunk every public route loads (CI's `bundle-check` budget). The copy of 23 pages there cost every route about 41 KB gzip. So no route file, and nothing a route file imports, may import a page at the top: a route loads its page with `loader: async () => (await import(...))`, the `/guides` index loads `meta.ts`, and `tests/unit/seo-pages.test.ts` fails on a static import of page copy and on a list that differs from the pages.
