import { createFileRoute, notFound } from "@tanstack/react-router";
import { SeoPage } from "../components/site/seo-page";
import { guideLoaders } from "../content/seo/loaders";
import { seoPageHead } from "../lib/seo-page";

// Every article guide is a content file in `src/content/seo` under `/guides/`: adding one adds its address. The
// content is static, so the page costs no query, and the loader fetches the copy of this one guide only (never the
// others, never the entry chunk). An unknown slug answers 404 before any rendering.
export const Route = createFileRoute("/_site/guides/$slug")({
  loader: ({ params }) => {
    const load = guideLoaders.get(params.slug);
    if (load === undefined) throw notFound();
    return load();
  },
  head: ({ loaderData, matches }) => seoPageHead(loaderData, matches),
  component: GuideRoute,
});

function GuideRoute() {
  return <SeoPage page={Route.useLoaderData()} />;
}
