import { createFileRoute, notFound } from "@tanstack/react-router";
import { SeoPage } from "../components/site/seo-page";
import { guidePageAt } from "../content/seo";
import { unavailableHead } from "../lib/seo";
import { seoPageHead } from "../lib/seo-page";

// Every article guide is a content file in `src/content/seo` under `/guides/`: adding one adds its address. The
// content is bundled, so the page costs no query; an unknown slug answers 404 before any rendering.
export const Route = createFileRoute("/_site/guides/$slug")({
  beforeLoad: ({ params }) => {
    if (guidePageAt(params.slug) === undefined) throw notFound();
  },
  head: ({ params, matches }) => {
    const page = guidePageAt(params.slug);
    return page === undefined ? unavailableHead("Guide") : seoPageHead(page, matches);
  },
  component: GuideRoute,
});

function GuideRoute() {
  const page = guidePageAt(Route.useParams().slug);
  return page === undefined ? null : <SeoPage page={page} />;
}
